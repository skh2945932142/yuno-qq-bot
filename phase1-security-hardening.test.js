import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './src/bootstrap-phase1.js';
import { config } from './src/config.js';
import { createToolRegistry } from './src/tools/registry.js';
import { registerQueryTools } from './src/query-tools.js';

function makeLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function invokeApp(app, {
  method = 'GET',
  url = '/',
  headers = {},
  body = undefined,
} = {}) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      body: undefined,
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[String(name).toLowerCase()];
      },
      removeHeader(name) {
        delete this.headers[String(name).toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(payload) {
        this.body = payload;
        resolve(this);
      },
      json(payload) {
        this.body = payload;
        resolve(this);
      },
      end(payload) {
        this.body = payload;
        resolve(this);
      },
    };

    const request = {
      method,
      url,
      headers,
      body,
      on() {},
    };

    app.handle(request, response, reject);
  });
}

test('onebot webhook rejects missing or invalid shared secret before processing payload', async () => {
  const app = createApp({
    config: {
      ...config,
      onebotWebhookSecret: 'webhook-secret',
      webhookBodyLimit: '128kb',
    },
  });

  const missing = await invokeApp(app, {
    method: 'POST',
    url: '/onebot',
    headers: { 'content-type': 'application/json' },
    body: { post_type: 'meta_event', meta_event_type: 'heartbeat' },
  });
  assert.equal(missing.statusCode, 401);

  const invalid = await invokeApp(app, {
    method: 'POST',
    url: '/onebot',
    headers: {
      'content-type': 'application/json',
      'x-yuno-webhook-secret': 'wrong',
    },
    body: { post_type: 'meta_event', meta_event_type: 'heartbeat' },
  });
  assert.equal(invalid.statusCode, 401);
});

test('onebot webhook accepts x-yuno-webhook-secret and bearer authorization', async () => {
  const app = createApp({
    config: {
      ...config,
      onebotWebhookSecret: 'webhook-secret',
      webhookBodyLimit: '128kb',
    },
  });

  const customHeader = await invokeApp(app, {
    method: 'POST',
    url: '/onebot',
    headers: {
      'content-type': 'application/json',
      'x-yuno-webhook-secret': 'webhook-secret',
    },
    body: { post_type: 'meta_event', meta_event_type: 'heartbeat' },
  });
  assert.equal(customHeader.statusCode, 200);

  const bearerHeader = await invokeApp(app, {
    method: 'POST',
    url: '/onebot',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer webhook-secret',
    },
    body: { post_type: 'meta_event', meta_event_type: 'heartbeat' },
  });
  assert.equal(bearerHeader.statusCode, 200);
});

test('metrics endpoint requires bearer token when METRICS_AUTH_TOKEN is configured', async () => {
  const app = createApp({
    config: {
      ...config,
      enableMetrics: true,
      metricsPath: '/metrics',
      metricsAuthToken: 'metrics-secret',
    },
  });

  const unauthorized = await invokeApp(app, { method: 'GET', url: '/metrics' });
  assert.equal(unauthorized.statusCode, 401);

  const authorized = await invokeApp(app, {
    method: 'GET',
    url: '/metrics',
    headers: { authorization: 'Bearer metrics-secret' },
  });
  assert.equal(authorized.statusCode, 200);
  assert.match(String(authorized.getHeader('content-type') || ''), /text\/plain/);
});

test('tool registry enforces admin permissions before tool execution', async () => {
  let executed = false;
  const registry = createToolRegistry({
    logger: makeLogger(),
    adminUserId: 'admin-user',
  });
  registry.register({
    name: 'admin_only_tool',
    permissions: ['admin'],
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      executed = true;
      return { ok: true };
    },
  });

  await assert.rejects(
    () => registry.execute('admin_only_tool', {}, { event: { userId: 'normal-user' } }),
    /permission|admin/i
  );
  assert.equal(executed, false);

  const result = await registry.execute('admin_only_tool', {}, { event: { userId: 'admin-user' } });
  assert.deepEqual(result, { ok: true });
});

test('memory and style commands do not reveal profile details in group chat', async () => {
  const registry = registerQueryTools(createToolRegistry({
    logger: makeLogger(),
    adminUserId: 'admin-user',
  }));
  const context = {
    event: {
      platform: 'qq',
      chatType: 'group',
      chatId: 'group-1',
      userId: 'user-1',
    },
    relation: { memorySummary: 'private relation summary' },
    userState: { currentEmotion: 'CALM' },
    userProfile: {
      profileSummary: 'private profile summary',
      responsePreference: 'private response preference',
    },
    memoryContext: {
      eventMemories: [{ summary: 'private memory event', eventType: 'milestone' }],
    },
  };

  const memory = await registry.execute('get_memory', {}, context);
  assert.match(memory.summary, /private chat|私聊/i);
  assert.doesNotMatch(memory.summary, /private memory event|private profile summary/);

  const style = await registry.execute('get_style', {}, context);
  assert.match(style.summary, /private chat|私聊/i);
  assert.doesNotMatch(style.summary, /private response preference|private profile summary/);

  const forget = await registry.execute('forget_user_memory', { query: 'private' }, context);
  assert.match(forget.summary, /private chat|私聊/i);
});
