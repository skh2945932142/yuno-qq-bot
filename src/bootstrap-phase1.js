import express from 'express';
import axios from 'axios';
import { timingSafeEqual } from 'node:crypto';
import {
  config,
  describeHttpBaseUrlProblem,
  getRuntimeRoleCapabilities,
  validateRuntimeConfig,
} from './config.js';
import { connectDB, isDbReady } from './db.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';
import { validateOnebotMessageEvent } from './adapters/onebot-event.js';
import { processPersistJob, processReplyJob, shouldRespondToEvent } from './message-workflow.js';
import { runYunoConversation } from './yuno-core.js';
import { createQueueManager } from './queue-manager.js';
import { metrics, recordWorkflowMetric } from './metrics.js';
import { getTelemetryStatus, initializeTelemetry } from './telemetry.js';
import { setRuntimeServices, getRuntimeServices } from './runtime-services.js';
import { recordInboundGroupObservation } from './group-ops.js';
import { evaluateGroupAutomation } from './group-automation.js';
import { isNonTargetPokeEvent } from './message-analysis.js';
import { resolveFfmpegPath } from './services/audio.js';
import { handleInboundEvent } from './inbound-event-service.js';
import { buildDeliveryKey, createDeliveryLedger } from './delivery-ledger.js';

function buildReplyJobId(event) {
  return `reply:${event.platform}:${event.chatId}:${event.messageId || `${event.userId}:${event.timestamp}`}`;
}

function buildAutomationDeliveryKey(event, toolResult, index = 0) {
  return buildDeliveryKey(
    event,
    `automation-${index}-${toolResult?.tool || 'unknown'}`
  );
}

function constantTimeEquals(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function getHeaderValue(req, name) {
  const direct = req.get?.(name);
  if (direct) return String(direct);
  const lower = String(name || '').toLowerCase();
  return String(req.headers?.[lower] || req.headers?.[name] || '');
}

function getBearerToken(req) {
  const authorization = getHeaderValue(req, 'authorization');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function isProductionRuntime(runtimeConfig = {}) {
  return String(runtimeConfig.nodeEnv || process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function hasSharedSecret(req, expectedSecret, headerName, options = {}) {
  if (!expectedSecret) return !options.requireSecret;
  const directSecret = getHeaderValue(req, headerName);
  const bearerToken = getBearerToken(req);
  return [directSecret, bearerToken].some((candidate) => constantTimeEquals(candidate, expectedSecret));
}

async function deliverAutomationToolResult(event, toolResult, options = {}) {
  return runYunoConversation({
    platform: event.platform,
    scene: event.chatType,
    userId: event.userId,
    groupId: event.chatType === 'group' ? event.chatId : '',
    chatId: event.chatId,
    username: event.userName,
    rawMessage: event.rawText || event.text || '',
    metadata: {
      messageId: event.messageId,
      timestamp: event.timestamp,
      mentionsBot: event.mentionsBot,
      source: event.source,
      sender: event.sender,
      attachments: event.attachments,
      replyTo: event.replyTo,
    },
  }, {
    toolResult,
    responseMode: 'send',
    deliveryKey: options.deliveryKey,
  });
}

export async function processReplyQueueJob(payload, job = {}, deps = {}) {
  const deliverAutomation = deps.deliverAutomationToolResult || deliverAutomationToolResult;
  const processReply = deps.processReplyJob || processReplyJob;
  if (payload?.kind === 'automation-tool-result') {
    return deliverAutomation(payload.event, payload.toolResult, {
      deliveryKey: payload.deliveryKey,
    });
  }
  return processReply(payload, {
    queueJobId: job.id,
  });
}

function observeGroupEventInBackground(event) {
  recordInboundGroupObservation(event).catch((error) => {
    logger.warn('group-ops', 'Failed to record inbound group observation', {
      message: error.message,
      chatId: event.chatId,
      userId: event.userId,
      messageId: event.messageId,
    });
  });
}

function dispatchAutomationToolResults(event, toolResults = []) {
  if (!Array.isArray(toolResults) || toolResults.length === 0) {
    return;
  }

  const runtimeServices = getRuntimeServices();
  const queueManager = runtimeServices.queueManager;
  const capabilities = getRuntimeRoleCapabilities(config.yunoRole) || getRuntimeRoleCapabilities('all');
  const deliveries = toolResults.map((toolResult, index) => {
    const deliveryKey = buildAutomationDeliveryKey(event, toolResult, index);
    if (queueManager?.enqueueReply) {
      return queueManager.enqueueReply({
        kind: 'automation-tool-result',
        event,
        toolResult,
        deliveryKey,
      }, {
        jobId: `automation:${deliveryKey}`,
      });
    }
    if (capabilities.directDelivery) {
      return deliverAutomationToolResult(event, toolResult, { deliveryKey });
    }
    return Promise.reject(new Error('Automation delivery requires a reply queue'));
  });

  Promise.allSettled(deliveries)
    .then((results) => {
      results.forEach((result, index) => {
        const tool = toolResults[index]?.tool || 'unknown';
        if (result.status === 'fulfilled') {
          recordWorkflowMetric('yuno_automation_messages_total', 1, {
            chat_type: event.chatType,
            tool,
          });
          return;
        }

        logger.warn('automation', 'Failed to deliver automation tool result', {
          message: result.reason?.message || String(result.reason || 'unknown-error'),
          chatId: event.chatId,
          userId: event.userId,
          messageId: event.messageId,
          tool,
        });
      });
    })
    .catch((error) => {
      logger.warn('automation', 'Automation delivery pipeline failed', {
        message: error.message,
        chatId: event.chatId,
        userId: event.userId,
        messageId: event.messageId,
      });
    });
}

async function probeQdrantReadiness() {
  if (!config.qdrantUrl || !config.qdrantCollection) {
    return {
      enabled: false,
      ready: true,
      reason: 'not-configured',
    };
  }

  const urlProblem = describeHttpBaseUrlProblem(config.qdrantUrl);
  if (urlProblem) {
    return {
      enabled: true,
      ready: false,
      reason: `invalid-url:${urlProblem}`,
    };
  }

  const headers = config.qdrantApiKey
    ? { 'api-key': config.qdrantApiKey }
    : {};

  try {
    await axios.get(`${config.qdrantUrl}/collections/${config.qdrantCollection}`, {
      headers,
      maxRedirects: 0,
      timeout: Math.min(config.requestTimeoutMs, 5000),
    });
    return {
      enabled: true,
      ready: true,
      reason: 'ok',
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return {
        enabled: true,
        ready: false,
        reason: 'collection-missing',
      };
    }

    return {
      enabled: true,
      ready: false,
      reason: `unreachable:${error.response?.status || error.code || 'unknown'}`,
    };
  }
}

function buildQdrantHint(reason = '') {
  if (String(reason).startsWith('invalid-url')) {
    return 'QDRANT_URL must be a full http:// or https:// URL. On Zeabur, do not set only a host or collection name.';
  }
  if (String(reason).includes(':401')) {
    return 'Qdrant rejected the request. Check QDRANT_API_KEY and the selected Zeabur/Qdrant endpoint.';
  }
  if (reason === 'collection-missing') {
    return 'Qdrant is reachable but the collection is missing. Check QDRANT_COLLECTION and run npm run kb:sync.';
  }
  return 'Check QDRANT_URL/QDRANT_COLLECTION and run npm run kb:sync if collection is missing.';
}

async function probeVoiceReadiness() {
  if (!config.enableVoice) {
    return {
      enabled: false,
      ready: true,
      reason: 'disabled',
    };
  }

  const usesVoiceDesign = config.ttsProvider === 'mimo'
    && config.ttsModel === 'mimo-v2.5-tts-voicedesign';
  const hasVoiceConfig = usesVoiceDesign
    ? Boolean(config.ttsVoiceDesign)
    : Boolean(config.ttsVoice || config.yunoVoiceUri);

  if (!hasVoiceConfig || !config.ttsBaseUrl || !config.ttsApiKey) {
    return {
      enabled: true,
      ready: false,
      reason: 'tts-config-missing',
    };
  }

  const ffmpegPath = await resolveFfmpegPath({ skipCache: true });
  if (!ffmpegPath) {
    return {
      enabled: true,
      ready: false,
      reason: 'ffmpeg-unavailable',
    };
  }

  return {
    enabled: true,
    ready: true,
    reason: 'ok',
    ffmpegPath,
  };
}

async function probeRuntimeReadiness(capabilities = getRuntimeRoleCapabilities('all')) {
  const [qdrant, voice] = await Promise.all([
    capabilities.model
      ? probeQdrantReadiness()
      : Promise.resolve({ enabled: false, ready: true, reason: 'role-disabled' }),
    capabilities.replyWorker
      ? probeVoiceReadiness()
      : Promise.resolve({ enabled: false, ready: true, reason: 'role-disabled' }),
  ]);

  return { qdrant, voice };
}

export function createApp(options = {}) {
  const runtimeConfig = options.config || config;
  const roleCapabilities = getRuntimeRoleCapabilities(runtimeConfig.yunoRole || 'all')
    || getRuntimeRoleCapabilities('all');
  const runtimeDeps = {
    handleInboundEvent,
    validateOnebotMessageEvent,
    shouldRespondToEvent,
    runYunoConversation,
    isNonTargetPokeEvent,
    observeGroupEventInBackground,
    evaluateGroupAutomation,
    dispatchAutomationToolResults,
    getRuntimeServices,
    isDbReady,
    getTelemetryStatus,
    ...options.deps,
  };
  const app = express();
  app.use(express.json({ limit: runtimeConfig.webhookBodyLimit || '128kb' }));

  app.post('/onebot', async (req, res) => {
    if (!roleCapabilities.onebotIngress) {
      res.status(404).send('not available for this role');
      return;
    }
    if (!hasSharedSecret(req, runtimeConfig.onebotWebhookSecret, 'x-yuno-webhook-secret', {
      requireSecret: isProductionRuntime(runtimeConfig),
    })) {
      res.status(401).send('unauthorized');
      return;
    }

    res.send();

    const validation = runtimeDeps.validateOnebotMessageEvent(req.body);
    if (!validation.ok) {
      if (validation.reason === 'system_payload') {
        return;
      }
      logger.info('webhook', 'Ignored unsupported webhook payload', {
        errors: validation.errors,
        postType: validation.meta?.postType,
        messageType: validation.meta?.messageType,
        noticeType: validation.meta?.noticeType,
        metaEventType: validation.meta?.metaEventType,
        subType: validation.meta?.subType,
      });
      return;
    }

    const event = validation.value;
    recordWorkflowMetric('yuno_incoming_messages_total', 1, {
      chat_type: event.chatType,
    });

    try {
      await runtimeDeps.handleInboundEvent(event, {
        deps: {
          isNonTargetPokeEvent: runtimeDeps.isNonTargetPokeEvent,
          observeGroupEvent: runtimeDeps.observeGroupEventInBackground,
          evaluateGroupAutomation: runtimeDeps.evaluateGroupAutomation,
          dispatchAutomationToolResults: runtimeDeps.dispatchAutomationToolResults,
          shouldRespondToEvent: runtimeDeps.shouldRespondToEvent,
          onReplyApproved: async ({ event: approvedEvent, decision }) => {
            const runtimeServices = runtimeDeps.getRuntimeServices();
            return runtimeServices.queueManager.enqueueReply({
              event: approvedEvent,
              analysis: decision.analysis,
            }, {
              jobId: buildReplyJobId(approvedEvent),
            });
          },
        },
      });
    } catch (error) {
      logger.error('webhook', 'Failed to process incoming message', {
        message: error.message,
        chatId: event.chatId,
        userId: event.userId,
        messageId: event.messageId,
      });
    }
  });

  app.post('/api/yuno/conversation', async (req, res) => {
    if (!roleCapabilities.conversationApi) {
      res.status(404).json({ error: 'not_available_for_role' });
      return;
    }
    if (!hasSharedSecret(req, runtimeConfig.onebotWebhookSecret, 'x-yuno-api-secret', {
      requireSecret: isProductionRuntime(runtimeConfig),
    })) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const responseMode = req.body.responseMode || 'capture';
    if (responseMode === 'send' && !roleCapabilities.directDelivery) {
      res.status(400).json({ error: 'response_mode_not_allowed', allowed: ['capture'] });
      return;
    }

    try {
      const result = await runtimeDeps.runYunoConversation(req.body.input, {
        responseMode,
        pluginRoute: req.body.pluginRoute,
        toolResult: req.body.toolResult,
      });

      res.json(result);
    } catch (error) {
      logger.error('api', 'Yuno conversation API failed', {
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        error: 'internal_error',
        message: error.message,
      });
    }
  });

  app.get('/health', (_req, res) => {
    res.send('Yuno online');
  });

  app.get('/ready', (_req, res) => {
    const runtimeServices = runtimeDeps.getRuntimeServices();
    const dbReady = !roleCapabilities.database || runtimeDeps.isDbReady();
    const queueStatus = runtimeServices.queueManager?.getStatus() || null;
    const queueRequired = roleCapabilities.queueProducer
      || roleCapabilities.replyWorker
      || roleCapabilities.persistWorker;
    const queueReady = !queueRequired || Boolean(queueStatus?.ready);
    const ready = dbReady && queueReady;
    const readiness = runtimeServices.readiness || {};
    const degraded = Object.values(readiness)
      .some((item) => item && item.enabled && !item.ready);
    res.status(ready ? 200 : 503).json({
      ready,
      degraded,
      role: roleCapabilities.role,
      db: dbReady,
      queue: queueStatus,
      telemetry: runtimeDeps.getTelemetryStatus(),
      readiness,
    });
  });

  app.get(runtimeConfig.metricsPath, (req, res) => {
    if (!runtimeConfig.enableMetrics) {
      res.status(404).send('metrics disabled');
      return;
    }

    if (!hasSharedSecret(req, runtimeConfig.metricsAuthToken, 'x-yuno-metrics-token')) {
      res.status(401).send('unauthorized');
      return;
    }

    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.snapshot());
  });

  return app;
}

export async function startApplication() {
  const capabilities = validateRuntimeConfig(config);
  await connectDB();
  const deliveryLedger = capabilities.directDelivery ? createDeliveryLedger() : null;
  await initializeTelemetry(config);

  const needsQueue = capabilities.queueProducer
    || capabilities.replyWorker
    || capabilities.persistWorker;
  const queueManager = needsQueue
    ? await createQueueManager(config, {
        replyJob: processReplyQueueJob,
        persistJob: async (payload, job) => processPersistJob(payload, {
          queueJobId: job.id,
        }),
        workers: {
          reply: capabilities.replyWorker,
          persist: capabilities.persistWorker,
        },
        deferWorkers: true,
      }, {
        allowInlineFallback: !capabilities.requiresDistributedQueue,
      })
    : null;
  const readiness = await probeRuntimeReadiness(capabilities);
  if (readiness.qdrant.enabled && !readiness.qdrant.ready) {
    logger.warn('bootstrap', 'Qdrant is degraded; retrieval will gracefully fall back', {
      reason: readiness.qdrant.reason,
      hint: buildQdrantHint(readiness.qdrant.reason),
    });
  }
  if (readiness.voice.enabled && !readiness.voice.ready) {
    logger.warn('bootstrap', 'Voice is degraded; text reply will continue', {
      reason: readiness.voice.reason,
      hint: 'Check ENABLE_VOICE, FFMPEG_PATH, TTS_PROVIDER, TTS_VOICE_DESIGN or TTS_VOICE/YUNO_VOICE_URI, TTS_BASE_URL, TTS_MODEL, and TTS_API_KEY.',
    });
  }

  setRuntimeServices({ queueManager, readiness, deliveryLedger });
  await queueManager?.startWorkers();
  if (capabilities.scheduler) {
    startScheduler();
  }

  let server = null;
  if (capabilities.http) {
    const app = createApp();
    server = app.listen(config.port, () => {
      logger.info('webhook', 'Yuno HTTP runtime started', {
        role: capabilities.role,
        port: config.port,
        queueMode: queueManager?.getStatus().mode || 'disabled',
        metricsPath: config.metricsPath,
        readiness,
      });
    });
  } else {
    logger.info('bootstrap', 'Yuno worker runtime started', {
      role: capabilities.role,
      queueMode: queueManager?.getStatus().mode || 'disabled',
      scheduler: capabilities.scheduler,
      readiness,
    });
  }

  return {
    role: capabilities.role,
    capabilities,
    queueManager,
    deliveryLedger,
    readiness,
    server,
  };
}
