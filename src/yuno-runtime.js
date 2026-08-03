import axios from 'axios';
import { config, describeHttpBaseUrlProblem, validateRuntimeConfig } from './config.js';
import { connectDB, disconnectDB, isDbReady } from './db.js';
import { logger } from './logger.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { processPersistJob, processReplyJob } from './message-workflow.js';
import { runYunoConversation } from './yuno-core.js';
import { createQueueManager } from './queue-manager.js';
import { initializeTelemetry, shutdownTelemetry } from './telemetry.js';
import { getRuntimeServices, resetRuntimeServices, setRuntimeServices } from './runtime-services.js';
import { resolveFfmpegPath } from './services/audio.js';
import { buildDeliveryKey, createDeliveryLedger } from './delivery-ledger.js';
import { getActiveConversationCount, waitForConversationsIdle } from './conversation-executor.js';
import { getRetrievalProviderStatus } from './retrieval-gateway.js';

let activeRuntime = null;
let initializingRuntime = null;
let shuttingDownRuntime = null;

function buildAutomationDeliveryKey(event, toolResult, index = 0) {
  return buildDeliveryKey(event, `automation-${index}-${toolResult?.tool || 'unknown'}`);
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
      selfId: event.selfId,
    },
  }, {
    toolResult,
    responseMode: 'send',
    deliveryKey: options.deliveryKey,
  });
}

export async function processReplyQueueJob(payload, job = {}, deps = {}) {
  if (payload?.kind === 'automation-tool-result') {
    const deliver = deps.deliverAutomationToolResult || deliverAutomationToolResult;
    return deliver(payload.event, payload.toolResult, { deliveryKey: payload.deliveryKey });
  }

  return (deps.processReplyJob || processReplyJob)(payload, { queueJobId: job.id });
}

export function dispatchAutomationToolResults(event, toolResults = []) {
  if (!Array.isArray(toolResults) || toolResults.length === 0) return [];

  const queueManager = getRuntimeServices().queueManager;
  if (!queueManager) {
    const error = new Error('YUNO_QUEUE_UNAVAILABLE');
    error.code = 'YUNO_QUEUE_UNAVAILABLE';
    throw error;
  }

  const deliveries = toolResults.map((toolResult, index) => {
    const deliveryKey = buildAutomationDeliveryKey(event, toolResult, index);
    return queueManager.enqueueReply({
      kind: 'automation-tool-result',
      event,
      toolResult,
      deliveryKey,
    }, {
      jobId: `automation:${deliveryKey}`,
    });
  });

  return Promise.allSettled(deliveries).then((results) => {
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') return;
      logger.warn('automation', 'Failed to deliver automation tool result', {
        message: result.reason?.message || String(result.reason || 'unknown-error'),
        chatId: event.chatId,
        userId: event.userId,
        messageId: event.messageId,
        tool: toolResults[index]?.tool || 'unknown',
      });
    });
    return results;
  });
}

async function probeQdrantReadiness(runtimeConfig = config) {
  if (!runtimeConfig.qdrantUrl || !runtimeConfig.qdrantCollection) {
    return { enabled: false, ready: true, reason: 'not-configured' };
  }

  const urlProblem = describeHttpBaseUrlProblem(runtimeConfig.qdrantUrl);
  if (urlProblem) {
    return { enabled: true, ready: false, reason: `invalid-url:${urlProblem}` };
  }

  try {
    await axios.get(`${runtimeConfig.qdrantUrl}/collections/${runtimeConfig.qdrantCollection}`, {
      headers: runtimeConfig.qdrantApiKey ? { 'api-key': runtimeConfig.qdrantApiKey } : {},
      maxRedirects: 0,
      timeout: Math.min(runtimeConfig.requestTimeoutMs, 5000),
    });
    return { enabled: true, ready: true, reason: 'ok' };
  } catch (error) {
    return {
      enabled: true,
      ready: false,
      reason: error.response?.status === 404
        ? 'collection-missing'
        : `unreachable:${error.response?.status || error.code || 'unknown'}`,
    };
  }
}

function probeRetrievalReadiness(runtimeConfig = config) {
  if (!runtimeConfig.retrievalHybridEnabled) {
    return { enabled: false, ready: true, reason: 'disabled' };
  }

  const providerStatus = getRetrievalProviderStatus({ config: runtimeConfig });
  if (!runtimeConfig.qdrantUrl) {
    return {
      enabled: true,
      ready: false,
      reason: 'qdrant-config-missing',
      provider: providerStatus.provider,
    };
  }
  if (!runtimeConfig.qdrantHybridCollection || !providerStatus.configured) {
    return {
      enabled: true,
      ready: false,
      reason: providerStatus.configured
        ? 'hybrid-collection-missing'
        : `provider-config-missing:${providerStatus.missing.join(',')}`,
      provider: providerStatus.provider,
    };
  }

  return {
    enabled: true,
    ready: true,
    reason: providerStatus.supportsSparse ? 'hybrid-configured' : 'dense-rerank-configured',
    provider: providerStatus.provider,
  };
}

async function probeVoiceReadiness(runtimeConfig = config) {
  if (!runtimeConfig.enableVoice) {
    return { enabled: false, ready: true, reason: 'disabled' };
  }

  const usesVoiceDesign = runtimeConfig.ttsProvider === 'mimo'
    && runtimeConfig.ttsModel === 'mimo-v2.5-tts-voicedesign';
  const hasVoiceConfig = usesVoiceDesign
    ? Boolean(runtimeConfig.ttsVoiceDesign)
    : Boolean(runtimeConfig.ttsVoice || runtimeConfig.yunoVoiceUri);
  if (!hasVoiceConfig || !runtimeConfig.ttsBaseUrl || !runtimeConfig.ttsApiKey) {
    return { enabled: true, ready: false, reason: 'tts-config-missing' };
  }

  const ffmpegPath = await resolveFfmpegPath({ skipCache: true });
  return ffmpegPath
    ? { enabled: true, ready: true, reason: 'ok', ffmpegPath }
    : { enabled: true, ready: false, reason: 'ffmpeg-unavailable' };
}

export async function probeRuntimeReadiness(runtimeConfig = config) {
  const [qdrant, retrievalGateway, voice] = await Promise.all([
    probeQdrantReadiness(runtimeConfig),
    probeRetrievalReadiness(runtimeConfig),
    probeVoiceReadiness(runtimeConfig),
  ]);
  return { qdrant, retrievalGateway, voice };
}

export async function initializeYunoRuntime(options = {}) {
  if (activeRuntime) return activeRuntime;
  if (initializingRuntime) return initializingRuntime;
  if (shuttingDownRuntime) await shuttingDownRuntime;

  const runtimeConfig = options.config || config;
  const connectDatabase = options.connectDB || connectDB;
  const disconnectDatabase = options.disconnectDB || disconnectDB;
  const initializeRuntimeTelemetry = options.initializeTelemetry || initializeTelemetry;
  const shutdownRuntimeTelemetry = options.shutdownTelemetry || shutdownTelemetry;
  const createRuntimeQueue = options.createQueueManager || createQueueManager;
  const startRuntimeScheduler = options.startScheduler || startScheduler;
  const stopRuntimeScheduler = options.stopScheduler || stopScheduler;
  const createRuntimeLedger = options.createDeliveryLedger || createDeliveryLedger;
  const probeReadiness = options.probeRuntimeReadiness || probeRuntimeReadiness;

  initializingRuntime = (async () => {
    let queueManager = null;
    let scheduler = null;
    try {
      validateRuntimeConfig(runtimeConfig);
      await connectDatabase(runtimeConfig);
      await initializeRuntimeTelemetry(runtimeConfig);
      queueManager = await createRuntimeQueue(runtimeConfig, {
        replyJob: processReplyQueueJob,
        persistJob: async (payload, job) => processPersistJob(payload, { queueJobId: job.id }),
        workers: { reply: true, persist: true },
        deferWorkers: true,
      }, {
        allowInlineFallback: true,
      });

      const readiness = await probeReadiness(runtimeConfig);
      const deliveryLedger = createRuntimeLedger();
      setRuntimeServices({
        queueManager,
        readiness,
        deliveryLedger,
        deliveryAdapter: options.deliveryAdapter || null,
        protocolAdapter: options.protocolAdapter || null,
      });
      await queueManager.startWorkers();
      scheduler = options.startScheduler === false ? null : startRuntimeScheduler({ config: runtimeConfig });

      activeRuntime = {
        config: runtimeConfig,
        queueManager,
        readiness,
        deliveryLedger,
        scheduler,
        accepting: true,
        initializedAt: new Date(),
      };
      logger.info('runtime', 'Yuno embedded runtime started', {
        queueMode: queueManager.getStatus().mode,
        scheduler: Boolean(scheduler),
        readiness,
      });
      return activeRuntime;
    } catch (error) {
      activeRuntime = null;
      stopRuntimeScheduler();
      await queueManager?.close().catch(() => {});
      await shutdownRuntimeTelemetry().catch(() => {});
      await disconnectDatabase().catch(() => {});
      resetRuntimeServices();
      throw error;
    }
  })();

  try {
    return await initializingRuntime;
  } finally {
    initializingRuntime = null;
  }
}

export function isYunoRuntimeAcceptingMessages() {
  return Boolean(activeRuntime?.accepting);
}

export async function shutdownYunoRuntime(options = {}) {
  if (shuttingDownRuntime) return shuttingDownRuntime;

  shuttingDownRuntime = (async () => {
    if (initializingRuntime) {
      await initializingRuntime.catch(() => {});
    }

    const runtime = activeRuntime;
    activeRuntime = null;
    if (runtime) runtime.accepting = false;
    (options.stopScheduler || stopScheduler)();
    await (options.waitForConversationsIdle || waitForConversationsIdle)();
    await runtime?.queueManager?.close().catch((error) => {
      logger.warn('runtime', 'Failed to close queue manager', { message: error.message });
    });
    await (options.shutdownTelemetry || shutdownTelemetry)().catch((error) => {
      logger.warn('runtime', 'Failed to shut down telemetry', { message: error.message });
    });
    await (options.disconnectDB || disconnectDB)().catch((error) => {
      logger.warn('runtime', 'Failed to disconnect MongoDB', { message: error.message });
    });
    resetRuntimeServices();
    logger.info('runtime', 'Yuno embedded runtime stopped');
  })();

  try {
    await shuttingDownRuntime;
  } finally {
    shuttingDownRuntime = null;
  }
}

export function getYunoRuntimeStatus() {
  const runtimeServices = getRuntimeServices();
  const queue = runtimeServices.queueManager?.getStatus() || null;
  const readiness = runtimeServices.readiness || {};
  const degraded = Object.values(readiness).some((item) => item?.enabled && !item.ready);
  const scheduler = Boolean(activeRuntime?.scheduler?.started);
  return {
    initialized: Boolean(activeRuntime),
    accepting: Boolean(activeRuntime?.accepting),
    ready: Boolean(activeRuntime) && isDbReady() && Boolean(queue?.ready) && scheduler,
    degraded,
    db: isDbReady(),
    queue,
    readiness,
    scheduler,
    activeConversations: getActiveConversationCount(),
  };
}
