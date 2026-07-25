import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchAutomationToolResults,
  getYunoRuntimeStatus,
  initializeYunoRuntime,
  probeRuntimeReadiness,
  processReplyQueueJob,
  isYunoRuntimeAcceptingMessages,
  shutdownYunoRuntime,
} from './src/yuno-runtime.js';
import { getRuntimeServices } from './src/runtime-services.js';

function runtimeConfig() {
  return {
    mongodbUri: 'mongodb://localhost/yuno',
    mongoMaxPoolSize: 1,
    llmApiKey: 'analysis-key',
    llmChatModel: 'analysis-model',
    replyLlmApiKey: 'reply-key',
    replyLlmChatModel: 'reply-model',
    enableQueue: false,
    qdrantUrl: '',
    qdrantCollection: '',
    enableVoice: false,
  };
}

test('embedded Yuno runtime initializes once and shuts down in lifecycle order', async () => {
  const calls = [];
  const queueManager = {
    async startWorkers() { calls.push('workers:start'); },
    async close() { calls.push('queue:close'); },
    getStatus() { return { mode: 'inline', ready: true }; },
  };
  const options = {
    config: runtimeConfig(),
    deliveryAdapter: { sendReply: async () => true },
    protocolAdapter: { callAction: async () => [] },
    connectDB: async () => { calls.push('db:connect'); },
    disconnectDB: async () => { calls.push('db:disconnect'); },
    initializeTelemetry: async () => { calls.push('telemetry:start'); },
    shutdownTelemetry: async () => { calls.push('telemetry:stop'); },
    createQueueManager: async () => queueManager,
    probeRuntimeReadiness: async () => ({
      qdrant: { enabled: false, ready: true },
      voice: { enabled: false, ready: true },
    }),
    createDeliveryLedger: () => ({ execute: async (task) => task() }),
    startScheduler: () => {
      calls.push('scheduler:start');
      return { started: true };
    },
    stopScheduler: () => { calls.push('scheduler:stop'); },
  };

  const first = await initializeYunoRuntime(options);
  const second = await initializeYunoRuntime(options);
  assert.equal(first, second);
  assert.equal(isYunoRuntimeAcceptingMessages(), true);
  assert.equal(getRuntimeServices().deliveryAdapter, options.deliveryAdapter);

  await shutdownYunoRuntime({
    stopScheduler: options.stopScheduler,
    waitForConversationsIdle: async () => { calls.push('conversations:idle'); },
    shutdownTelemetry: options.shutdownTelemetry,
    disconnectDB: options.disconnectDB,
  });

  assert.equal(isYunoRuntimeAcceptingMessages(), false);
  assert.deepEqual(calls, [
    'db:connect',
    'telemetry:start',
    'workers:start',
    'scheduler:start',
    'scheduler:stop',
    'conversations:idle',
    'queue:close',
    'telemetry:stop',
    'db:disconnect',
  ]);
});

test('embedded Yuno runtime cleans resources after initialization failure', async () => {
  const calls = [];
  await assert.rejects(
    () => initializeYunoRuntime({
      config: runtimeConfig(),
      connectDB: async () => { calls.push('db:connect'); },
      disconnectDB: async () => { calls.push('db:disconnect'); },
      initializeTelemetry: async () => { calls.push('telemetry:start'); },
      shutdownTelemetry: async () => { calls.push('telemetry:stop'); },
      createQueueManager: async () => {
        throw new Error('queue startup failed');
      },
      stopScheduler: () => { calls.push('scheduler:stop'); },
    }),
    /queue startup failed/
  );

  assert.deepEqual(calls, [
    'db:connect',
    'telemetry:start',
    'scheduler:stop',
    'telemetry:stop',
    'db:disconnect',
  ]);
});


test('embedded runtime helper paths handle queue jobs, readiness, and unavailable automation queues', async () => {
  assert.deepEqual(await probeRuntimeReadiness({
    qdrantUrl: '',
    qdrantCollection: '',
    enableVoice: false,
  }), {
    qdrant: { enabled: false, ready: true, reason: 'not-configured' },
    voice: { enabled: false, ready: true, reason: 'disabled' },
  });

  const normal = await processReplyQueueJob({ id: 'job' }, { id: 'queue-1' }, {
    processReplyJob: async (payload, options) => ({ payload, options }),
  });
  assert.equal(normal.options.queueJobId, 'queue-1');

  const automated = await processReplyQueueJob({
    kind: 'automation-tool-result',
    event: { chatId: '30000' },
    toolResult: { tool: 'reminder_due' },
    deliveryKey: 'key',
  }, {}, {
    deliverAutomationToolResult: async (_event, tool, options) => ({ tool, options }),
  });
  assert.equal(automated.options.deliveryKey, 'key');
  assert.throws(() => dispatchAutomationToolResults({ chatId: '30000' }, [{ tool: 'x' }]), /YUNO_QUEUE_UNAVAILABLE/);
  assert.equal(getYunoRuntimeStatus().initialized, false);
});


test('embedded runtime can run schedulerless and dispatch automation through its in-process queue', async () => {
  const calls = [];
  const queueManager = {
    async startWorkers() { calls.push('workers:start'); },
    async close() { calls.push('queue:close'); },
    async enqueueReply(payload, options) {
      calls.push(`enqueue:${options.jobId}`);
      if (payload.toolResult.tool === 'broken') throw new Error('queue rejected');
      return { id: options.jobId };
    },
    getStatus() { return { mode: 'inline', ready: true }; },
  };
  await initializeYunoRuntime({
    config: runtimeConfig(),
    connectDB: async () => { calls.push('db:connect'); },
    disconnectDB: async () => { calls.push('db:disconnect'); },
    initializeTelemetry: async () => { calls.push('telemetry:start'); },
    shutdownTelemetry: async () => { calls.push('telemetry:stop'); },
    createQueueManager: async () => queueManager,
    probeRuntimeReadiness: async () => ({ qdrant: { enabled: true, ready: false }, voice: { enabled: false, ready: true } }),
    createDeliveryLedger: () => ({ execute: async (task) => task() }),
    startScheduler: false,
  });

  const results = await dispatchAutomationToolResults({ chatId: '30000', userId: '20000', messageId: 'm-1' }, [
    { tool: 'reminder_due' },
    { tool: 'broken' },
  ]);
  assert.equal(results.length, 2);
  assert.equal(getYunoRuntimeStatus().scheduler, false);
  await shutdownYunoRuntime({
    stopScheduler: () => { calls.push('scheduler:stop'); },
    waitForConversationsIdle: async () => { calls.push('conversations:idle'); },
    shutdownTelemetry: async () => { calls.push('telemetry:stop'); },
    disconnectDB: async () => { calls.push('db:disconnect'); },
  });
  assert.equal(calls.some((item) => item.startsWith('enqueue:automation:')), true);
});

test('embedded runtime closes an allocated queue when worker startup fails', async () => {
  let closed = 0;
  await assert.rejects(() => initializeYunoRuntime({
    config: runtimeConfig(),
    connectDB: async () => {},
    disconnectDB: async () => {},
    initializeTelemetry: async () => {},
    shutdownTelemetry: async () => {},
    createQueueManager: async () => ({
      async startWorkers() { throw new Error('worker startup failed'); },
      async close() { closed += 1; },
      getStatus() { return { mode: 'inline', ready: true }; },
    }),
    probeRuntimeReadiness: async () => ({ qdrant: { enabled: false, ready: true }, voice: { enabled: false, ready: true } }),
    createDeliveryLedger: () => ({ execute: async () => true }),
    stopScheduler: () => {},
  }), /worker startup failed/);
  assert.equal(closed, 1);
});

test('runtime readiness probes report invalid Qdrant URLs and missing voice configuration', async () => {
  const readiness = await probeRuntimeReadiness({
    qdrantUrl: 'qdrant:6333',
    qdrantCollection: 'knowledge',
    enableVoice: true,
    ttsProvider: 'openai_compatible',
    ttsVoice: '',
    yunoVoiceUri: '',
    ttsBaseUrl: '',
    ttsApiKey: '',
  });
  assert.equal(readiness.qdrant.reason, 'invalid-url:missing-protocol');
  assert.equal(readiness.voice.reason, 'tts-config-missing');
});


test('runtime shutdown tolerates queue close errors and readiness probes report unreachable services', async () => {
  const events = [];
  await initializeYunoRuntime({
    config: runtimeConfig(),
    connectDB: async () => {},
    disconnectDB: async () => { events.push('db'); },
    initializeTelemetry: async () => {},
    shutdownTelemetry: async () => { events.push('telemetry'); },
    createQueueManager: async () => ({
      async startWorkers() {},
      async close() { throw new Error('queue close failed'); },
      getStatus() { return { mode: 'inline', ready: true }; },
    }),
    probeRuntimeReadiness: async () => ({ qdrant: { enabled: false, ready: true }, voice: { enabled: false, ready: true } }),
    createDeliveryLedger: () => ({ execute: async () => true }),
    startScheduler: () => ({ started: true }),
  });
  await shutdownYunoRuntime({
    stopScheduler: () => {},
    waitForConversationsIdle: async () => {},
    shutdownTelemetry: async () => { events.push('telemetry'); },
    disconnectDB: async () => { events.push('db'); },
  });
  await shutdownYunoRuntime({
    stopScheduler: () => {},
    waitForConversationsIdle: async () => {},
    shutdownTelemetry: async () => {},
    disconnectDB: async () => {},
  });

  const readiness = await probeRuntimeReadiness({
    qdrantUrl: 'http://127.0.0.1:1',
    qdrantCollection: 'knowledge',
    qdrantApiKey: '',
    requestTimeoutMs: 1,
    enableVoice: true,
    ttsProvider: 'openai_compatible',
    ttsVoice: 'voice',
    yunoVoiceUri: '',
    ttsBaseUrl: 'https://example.invalid/tts',
    ttsApiKey: 'key',
  });
  assert.equal(events.includes('db'), true);
  assert.match(readiness.qdrant.reason, /^unreachable:/);
  assert.equal(readiness.voice.enabled, true);
});
