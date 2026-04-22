import express from 'express';
import axios from 'axios';
import { config, validateRuntimeConfig } from './config.js';
import { connectDB, isDbReady } from './db.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';
import { validateOnebotMessageEvent } from './adapters/onebot-event.js';
import { processPersistJob, processReplyJob, shouldRespondToEvent } from './message-workflow.js';
import { createQueueManager } from './queue-manager.js';
import { metrics, recordWorkflowMetric } from './metrics.js';
import { getTelemetryStatus, initializeTelemetry } from './telemetry.js';
import { setRuntimeServices, getRuntimeServices } from './runtime-services.js';
import { recordInboundGroupObservation } from './group-ops.js';
import { evaluateGroupAutomation } from './group-automation.js';
import { runYunoConversation } from './yuno-core.js';
import { isNonTargetPokeEvent } from './message-analysis.js';
import { resolveFfmpegPath } from './services/audio.js';

function buildReplyJobId(event) {
  return `reply:${event.platform}:${event.chatId}:${event.messageId || `${event.userId}:${event.timestamp}`}`;
}

async function deliverAutomationToolResult(event, toolResult) {
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

  Promise.allSettled(toolResults.map((toolResult) => deliverAutomationToolResult(event, toolResult)))
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

  const headers = config.qdrantApiKey
    ? { 'api-key': config.qdrantApiKey }
    : {};

  try {
    await axios.get(`${config.qdrantUrl}/collections/${config.qdrantCollection}`, {
      headers,
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

async function probeVoiceReadiness() {
  if (!config.enableVoice) {
    return {
      enabled: false,
      ready: true,
      reason: 'disabled',
    };
  }

  if (!config.yunoVoiceUri || !config.ttsBaseUrl || !config.ttsApiKey) {
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

async function probeRuntimeReadiness() {
  const [qdrant, voice] = await Promise.all([
    probeQdrantReadiness(),
    probeVoiceReadiness(),
  ]);

  return { qdrant, voice };
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.post('/onebot', async (req, res) => {
    res.send();

    const validation = validateOnebotMessageEvent(req.body);
    if (!validation.ok) {
      logger.info('webhook', 'Ignored unsupported webhook payload', {
        errors: validation.errors,
      });
      return;
    }

    const event = validation.value;
    recordWorkflowMetric('yuno_incoming_messages_total', 1, {
      chat_type: event.chatType,
    });

    try {
      let automationPromise = null;
      if (event.chatType === 'group' && isNonTargetPokeEvent(event)) {
        recordWorkflowMetric('yuno_poke_ignored_total', 1, {
          chat_type: event.chatType,
          reason: 'non-target-poke',
        });
        recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
          chat_type: event.chatType,
          reason: 'non-target-poke',
        });
        logger.info('webhook', 'Ignored non-target poke event', {
          chatId: event.chatId,
          userId: event.userId,
          messageId: event.messageId,
          decisionReason: 'non-target-poke',
        });
        return;
      }

      if (event.chatType === 'group') {
        observeGroupEventInBackground(event);
        automationPromise = evaluateGroupAutomation(event).catch((error) => {
          logger.warn('automation', 'Failed to evaluate group automation', {
            message: error.message,
            chatId: event.chatId,
            userId: event.userId,
            messageId: event.messageId,
          });
          return null;
        });

        if (event.source?.noticeType === 'group_increase') {
          const automationDecision = await automationPromise;
          dispatchAutomationToolResults(event, automationDecision?.toolResults || []);
          return;
        }
      }

      const decisionPromise = shouldRespondToEvent(event);
      const [decision, automationDecision] = await Promise.all([
        decisionPromise,
        automationPromise || Promise.resolve(null),
      ]);

      dispatchAutomationToolResults(event, automationDecision?.toolResults || []);

      if (automationDecision?.suppressNormalReply) {
        recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
          chat_type: event.chatType,
          reason: 'automation-suppressed',
        });
        return;
      }

      if (!decision.analysis.shouldRespond) {
        recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
          chat_type: event.chatType,
          reason: decision.analysis.reason,
        });
        return;
      }

      const runtimeServices = getRuntimeServices();
      await runtimeServices.queueManager.enqueueReply({
        event,
        analysis: decision.analysis,
      }, {
        jobId: buildReplyJobId(event),
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

  app.get('/health', (_req, res) => {
    res.send('Yuno online');
  });

  app.get('/ready', (_req, res) => {
    const runtimeServices = getRuntimeServices();
    const ready = isDbReady() && Boolean(runtimeServices.queueManager?.getStatus().ready);
    const readiness = runtimeServices.readiness || {};
    const degraded = Object.values(readiness)
      .some((item) => item && item.enabled && !item.ready);
    res.status(ready ? 200 : 503).json({
      ready,
      degraded,
      db: isDbReady(),
      queue: runtimeServices.queueManager?.getStatus() || null,
      telemetry: getTelemetryStatus(),
      readiness,
    });
  });

  app.get(config.metricsPath, (_req, res) => {
    if (!config.enableMetrics) {
      res.status(404).send('metrics disabled');
      return;
    }

    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.snapshot());
  });

  return app;
}

export async function startApplication() {
  validateRuntimeConfig();
  await connectDB();
  await initializeTelemetry(config);

  const queueManager = await createQueueManager(config, {
    replyJob: async (payload, job) => processReplyJob(payload, {
      queueJobId: job.id,
    }),
    persistJob: async (payload, job) => processPersistJob(payload, {
      queueJobId: job.id,
    }),
  });
  const readiness = await probeRuntimeReadiness();
  if (readiness.qdrant.enabled && !readiness.qdrant.ready) {
    logger.warn('bootstrap', 'Qdrant is degraded; retrieval will gracefully fall back', {
      reason: readiness.qdrant.reason,
      hint: 'Check QDRANT_URL/QDRANT_COLLECTION and run npm run kb:sync if collection is missing.',
    });
  }
  if (readiness.voice.enabled && !readiness.voice.ready) {
    logger.warn('bootstrap', 'Voice is degraded; text reply will continue', {
      reason: readiness.voice.reason,
      hint: 'Check ENABLE_VOICE, FFMPEG_PATH, YUNO_VOICE_URI, TTS_BASE_URL, and TTS_API_KEY.',
    });
  }

  setRuntimeServices({ queueManager, readiness });
  startScheduler();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info('webhook', 'Yuno QQ Bot started', {
      port: config.port,
      queueMode: queueManager.getStatus().mode,
      metricsPath: config.metricsPath,
      readiness,
    });
  });
}
