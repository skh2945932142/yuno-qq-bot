import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createApp,
  processReplyQueueJob,
} from './src/bootstrap-phase1.js';

function createRuntimeConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    yunoRole: 'all',
    onebotWebhookSecret: '',
    webhookBodyLimit: '128kb',
    metricsPath: '/metrics',
    enableMetrics: false,
    metricsAuthToken: '',
    ...overrides,
  };
}

function createDeps(overrides = {}) {
  const queueCalls = [];
  const deps = {
    validateOnebotMessageEvent: (payload) => ({ ok: true, value: payload }),
    shouldRespondToEvent: async () => ({ analysis: { shouldRespond: true, reason: 'test-allow' } }),
    runYunoConversation: async (input, options) => ({ input, options, response: { text: 'ok' } }),
    isNonTargetPokeEvent: () => false,
    observeGroupEventInBackground: () => {},
    evaluateGroupAutomation: async () => null,
    dispatchAutomationToolResults: () => {},
    getRuntimeServices: () => ({
      queueManager: {
        getStatus: () => ({ ready: true, mode: 'inline' }),
        enqueueReply: async (...args) => queueCalls.push(args),
      },
      readiness: {},
    }),
    isDbReady: () => true,
    getTelemetryStatus: () => ({ enabled: false }),
    ...overrides,
  };
  return { deps, queueCalls };
}

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function waitFor(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for asynchronous webhook work');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('OneBot route enforces production auth and enqueues a stable reply job', async () => {
  const { deps, queueCalls } = createDeps();
  const app = createApp({
    config: createRuntimeConfig({ nodeEnv: 'production', onebotWebhookSecret: 'webhook-secret' }),
    deps,
  });
  const event = {
    platform: 'qq', chatType: 'private', chatId: '10001', userId: '10001',
    messageId: 'm-1', timestamp: 1, rawText: 'hello', source: {},
  };

  await withServer(app, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/onebot`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
    });
    assert.equal(unauthorized.status, 401);

    const accepted = await fetch(`${baseUrl}/onebot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yuno-webhook-secret': 'webhook-secret' },
      body: JSON.stringify(event),
    });
    assert.equal(accepted.status, 200);
    await waitFor(() => queueCalls.length === 1);
  });

  assert.deepEqual(queueCalls[0], [
    { event, analysis: { shouldRespond: true, reason: 'test-allow' } },
    { jobId: 'reply:qq:10001:m-1' },
  ]);
});

test('OneBot route ignores invalid, non-target poke, and suppressed events', async () => {
  let mode = 'invalid';
  const { deps, queueCalls } = createDeps({
    validateOnebotMessageEvent: (payload) => mode === 'invalid'
      ? { ok: false, reason: 'system_payload', errors: [], meta: {} }
      : { ok: true, value: payload },
    isNonTargetPokeEvent: () => mode === 'poke',
    shouldRespondToEvent: async () => ({ analysis: { shouldRespond: false, reason: 'explicit-trigger-required' } }),
  });
  const app = createApp({ config: createRuntimeConfig(), deps });
  const event = {
    platform: 'qq', chatType: 'group', chatId: '20001', userId: '10001',
    messageId: 'm-2', timestamp: 2, rawText: 'hello', source: {},
  };

  await withServer(app, async (baseUrl) => {
    for (const currentMode of ['invalid', 'poke', 'suppressed']) {
      mode = currentMode;
      const response = await fetch(`${baseUrl}/onebot`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
      });
      assert.equal(response.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  assert.equal(queueCalls.length, 0);
});

test('Yuno conversation API accepts bearer auth and forwards capture options', async () => {
  const conversationCalls = [];
  const { deps } = createDeps({
    runYunoConversation: async (...args) => {
      conversationCalls.push(args);
      return { response: { text: 'captured' }, analysis: { reason: 'test' } };
    },
  });
  const app = createApp({
    config: createRuntimeConfig({ nodeEnv: 'production', onebotWebhookSecret: 'api-secret' }),
    deps,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/yuno/conversation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer api-secret' },
      body: JSON.stringify({
        input: { message: 'hello' }, responseMode: 'capture', pluginRoute: 'chat', toolResult: { ok: true },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).response.text, 'captured');
  });

  assert.deepEqual(conversationCalls[0], [
    { message: 'hello' },
    { responseMode: 'capture', pluginRoute: 'chat', toolResult: { ok: true } },
  ]);
});

test('Yuno conversation API returns 500 when the core throws', async () => {
  const { deps } = createDeps({
    runYunoConversation: async () => { throw new Error('core failed'); },
  });
  const app = createApp({ config: createRuntimeConfig(), deps });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/yuno/conversation`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: {} }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'internal_error', message: 'core failed' });
  });
});

test('readiness and metrics routes expose configured status and auth', async () => {
  const { deps } = createDeps({
    getRuntimeServices: () => ({
      queueManager: { getStatus: () => ({ ready: true, mode: 'inline' }) },
      readiness: { qdrant: { enabled: true, ready: false, reason: 'unavailable' } },
    }),
    isDbReady: () => true,
    getTelemetryStatus: () => ({ enabled: true }),
  });
  const app = createApp({
    config: createRuntimeConfig({ enableMetrics: true, metricsAuthToken: 'metrics-secret' }),
    deps,
  });

  await withServer(app, async (baseUrl) => {
    const readyResponse = await fetch(`${baseUrl}/ready`);
    assert.equal(readyResponse.status, 200);
    const ready = await readyResponse.json();
    assert.equal(ready.ready, true);
    assert.equal(ready.degraded, true);
    assert.deepEqual(ready.telemetry, { enabled: true });

    assert.equal((await fetch(`${baseUrl}/metrics`)).status, 401);
    const metricsResponse = await fetch(`${baseUrl}/metrics`, {
      headers: { 'x-yuno-metrics-token': 'metrics-secret' },
    });
    assert.equal(metricsResponse.status, 200);
    assert.match(metricsResponse.headers.get('content-type'), /text\/plain/);
  });
});

test('api role exposes capture only and does not expose OneBot ingress', async () => {
  const conversationCalls = [];
  const { deps } = createDeps({
    runYunoConversation: async (...args) => {
      conversationCalls.push(args);
      return { response: { text: 'captured' } };
    },
    getRuntimeServices: () => ({ queueManager: null, readiness: {} }),
  });
  const app = createApp({
    config: createRuntimeConfig({ yunoRole: 'api' }),
    deps,
  });

  await withServer(app, async (baseUrl) => {
    const onebot = await fetch(`${baseUrl}/onebot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(onebot.status, 404);

    const directSend = await fetch(`${baseUrl}/api/yuno/conversation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { message: 'send' }, responseMode: 'send' }),
    });
    assert.equal(directSend.status, 400);
    assert.deepEqual(await directSend.json(), {
      error: 'response_mode_not_allowed',
      allowed: ['capture'],
    });

    const capture = await fetch(`${baseUrl}/api/yuno/conversation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { message: 'capture' } }),
    });
    assert.equal(capture.status, 200);

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    const body = await ready.json();
    assert.equal(body.role, 'api');
    assert.equal(body.queue, null);
  });

  assert.equal(conversationCalls.length, 1);
  assert.equal(conversationCalls[0][1].responseMode, 'capture');
});

test('onebot ingress role does not expose the conversation API', async () => {
  const { deps } = createDeps();
  const app = createApp({
    config: createRuntimeConfig({ yunoRole: 'onebot-ingress' }),
    deps,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/yuno/conversation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    assert.equal(response.status, 404);
  });
});

test('reply queue routes automation payloads through the unified send path', async () => {
  const calls = [];
  const payload = {
    kind: 'automation-tool-result',
    event: { platform: 'qq', chatType: 'group', chatId: 'g1', messageId: 'm1' },
    toolResult: { tool: 'automation_keyword_alert', summary: 'alert' },
    deliveryKey: 'qq:group:g1:m1:automation-0-automation_keyword_alert',
  };

  const result = await processReplyQueueJob(payload, { id: 'job-1' }, {
    deliverAutomationToolResult: async (...args) => {
      calls.push(args);
      return { ok: true };
    },
    processReplyJob: async () => {
      throw new Error('automation payload must not enter normal reply processing');
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls[0], [
    payload.event,
    payload.toolResult,
    { deliveryKey: payload.deliveryKey },
  ]);
});

test('reply queue preserves the queue job id for normal replies', async () => {
  const calls = [];
  const payload = { event: { messageId: 'm2' }, analysis: { shouldRespond: true } };

  await processReplyQueueJob(payload, { id: 'job-2' }, {
    processReplyJob: async (...args) => calls.push(args),
  });

  assert.deepEqual(calls[0], [
    payload,
    { queueJobId: 'job-2' },
  ]);
});
