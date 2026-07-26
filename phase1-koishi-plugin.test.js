import test from 'node:test';
import assert from 'node:assert/strict';
import { createYunoKoishiPlugin } from './src/koishi-yuno-plugin.js';

function createContext() {
  const handlers = { ready: [], dispose: [] };
  const middlewares = [];
  return {
    bots: [],
    on(name, handler) {
      handlers[name] ||= [];
      handlers[name].push(handler);
    },
    middleware(handler) {
      middlewares.push(handler);
    },
    handlers,
    middlewares,
  };
}

function groupSession(content = 'hello') {
  return {
    type: 'message',
    subtype: 'group',
    selfId: '10000',
    userId: '20000',
    guildId: '30000',
    channelId: '30000',
    messageId: 'm-1',
    content,
    elements: [{ type: 'text', attrs: { content } }],
    getInternal: () => ({ post_type: 'message', message_type: 'group', group_id: 30000 }),
    async send() {},
  };
}

function privateSession(content, messageId) {
  return {
    type: 'message',
    subtype: 'private',
    isDirect: true,
    selfId: '10000',
    userId: '20000',
    channelId: 'private:20000',
    messageId,
    content,
    elements: [{ type: 'text', attrs: { content } }],
    getInternal: () => ({ post_type: 'message', message_type: 'private', user_id: 20000 }),
    async send() {},
  };
}

test('active Koishi plugin initializes runtime and sends each eligible event to Yuno exactly once', async () => {
  const ctx = createContext();
  const calls = [];
  createYunoKoishiPlugin({
    mode: 'active',
    config: { selfQq: '10000', adminQq: '90000', yunoPluginMode: 'active' },
    deliveryAdapter: {
      sendReply: async () => true,
      sendStructuredReply: async () => true,
      sendVoice: async () => true,
    },
    protocolAdapter: { callAction: async () => [] },
    initializeYunoRuntime: async () => ({ started: true }),
    shutdownYunoRuntime: async () => { calls.push('shutdown'); },
    isYunoRuntimeAcceptingMessages: () => true,
    runYunoConversation: async (event, options) => calls.push({ event, options }),
  })(ctx);

  await ctx.handlers.ready[0]();
  const result = await ctx.middlewares[0](groupSession(), async () => undefined);

  assert.equal(result, '');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event.chatId, '30000');
  assert.equal(calls[0].options.responseMode, 'send');
  await ctx.handlers.dispose[0]();
  assert.equal(calls.at(-1), 'shutdown');
});

test('active Koishi plugin aggregates rapid private messages in arrival order', async () => {
  const ctx = createContext();
  const calls = [];
  createYunoKoishiPlugin({
    mode: 'active',
    config: {
      selfQq: '10000',
      adminQq: '90000',
      yunoPluginMode: 'active',
      privateMessageAggregationEnabled: true,
      privateMessageAggregationWindowMs: 20,
      privateMessageAggregationMaxWindowMs: 100,
    },
    deliveryAdapter: {
      sendReply: async () => true,
      sendStructuredReply: async () => true,
      sendVoice: async () => true,
    },
    protocolAdapter: { callAction: async () => [] },
    initializeYunoRuntime: async () => ({ started: true }),
    shutdownYunoRuntime: async () => {},
    isYunoRuntimeAcceptingMessages: () => true,
    runYunoConversation: async (event) => calls.push(event),
  })(ctx);

  await ctx.handlers.ready[0]();
  const first = ctx.middlewares[0](privateSession('first', 'm-1'), async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const second = ctx.middlewares[0](privateSession('second', 'm-2'), async () => undefined);
  await Promise.all([first, second]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].rawText, 'first\nsecond');
  assert.deepEqual(calls[0].aggregatedMessageIds, ['m-1', 'm-2']);
  await ctx.handlers.dispose[0]();
});

test('active Koishi plugin releases a reservation when downstream middleware throws', async () => {
  const ctx = createContext();
  const calls = [];
  createYunoKoishiPlugin({
    mode: 'active',
    config: {
      selfQq: '10000',
      adminQq: '90000',
      yunoPluginMode: 'active',
      privateMessageAggregationEnabled: true,
      privateMessageAggregationWindowMs: 20,
      privateMessageAggregationMaxWindowMs: 100,
    },
    deliveryAdapter: {
      sendReply: async () => true,
      sendStructuredReply: async () => true,
      sendVoice: async () => true,
    },
    protocolAdapter: { callAction: async () => [] },
    initializeYunoRuntime: async () => ({ started: true }),
    shutdownYunoRuntime: async () => {},
    isYunoRuntimeAcceptingMessages: () => true,
    runYunoConversation: async (event) => calls.push(event.rawText),
  })(ctx);

  await ctx.handlers.ready[0]();
  await assert.rejects(
    () => ctx.middlewares[0](privateSession('broken', 'm-broken'), async () => {
      throw new Error('downstream failed');
    }),
    /downstream failed/
  );
  await ctx.middlewares[0](privateSession('next', 'm-next'), async () => undefined);

  assert.deepEqual(calls, ['next']);
  await ctx.handlers.dispose[0]();
});

test('active Koishi plugin flushes pending private messages before runtime shutdown', async () => {
  const ctx = createContext();
  const calls = [];
  createYunoKoishiPlugin({
    mode: 'active',
    config: {
      selfQq: '10000',
      adminQq: '90000',
      yunoPluginMode: 'active',
      privateMessageAggregationEnabled: true,
      privateMessageAggregationWindowMs: 100,
      privateMessageAggregationMaxWindowMs: 500,
    },
    deliveryAdapter: {
      sendReply: async () => true,
      sendStructuredReply: async () => true,
      sendVoice: async () => true,
    },
    protocolAdapter: { callAction: async () => [] },
    initializeYunoRuntime: async () => ({ started: true }),
    shutdownYunoRuntime: async () => calls.push('shutdown'),
    isYunoRuntimeAcceptingMessages: () => true,
    runYunoConversation: async (event) => calls.push(event.messageId),
  })(ctx);

  await ctx.handlers.ready[0]();
  const pending = ctx.middlewares[0](privateSession('pending', 'm-pending'), async () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ctx.handlers.dispose[0]();
  await pending;

  assert.deepEqual(calls, ['m-pending', 'shutdown']);
});

test('Koishi management command is admin-only and never enters Yuno', async () => {
  const ctx = createContext();
  let conversations = 0;
  createYunoKoishiPlugin({
    mode: 'shadow',
    config: { selfQq: '10000', adminQq: '90000', yunoPluginMode: 'shadow' },
    runYunoConversation: async () => { conversations += 1; },
  })(ctx);

  const denied = groupSession('/koishi status');
  denied.userId = '20000';
  const replies = [];
  denied.send = async (text) => replies.push(text);
  await ctx.middlewares[0](denied, async () => undefined);

  assert.deepEqual(replies, ['没有这个管理权限。']);
  assert.equal(conversations, 0);
});

test('shadow Koishi plugin observes the Koishi message session without invoking Yuno', () => {
  const ctx = createContext();
  const logs = [];
  let conversations = 0;
  createYunoKoishiPlugin({
    mode: 'shadow',
    config: { selfQq: '10000', adminQq: '90000', yunoPluginMode: 'shadow' },
    logger: {
      info: (category, message, meta) => logs.push({ category, message, meta }),
      warn() {},
      error() {},
    },
    runYunoConversation: async () => { conversations += 1; },
  })(ctx);

  ctx.handlers.message[0](groupSession());

  assert.equal(conversations, 0);
  assert.deepEqual(logs, [{
    category: 'koishi',
    message: 'shadow_session',
    meta: {
      selfId: '10000',
      userId: '20000',
      chatId: '30000',
      messageId: 'm-1',
      chatType: 'group',
      sessionType: 'message',
      postType: 'message',
      messageType: 'group',
      attachments: 0,
    },
  }]);
});
test('shadow Koishi plugin accepts Satori message-created sessions with attached OneBot metadata', async () => {
  const ctx = createContext();
  const logs = [];
  createYunoKoishiPlugin({
    mode: 'shadow',
    config: { selfQq: '10000', adminQq: '90000', yunoPluginMode: 'shadow' },
    logger: {
      info: (category, message, meta) => logs.push({ category, message, meta }),
      warn() {},
      error() {},
    },
  })(ctx);

  const session = groupSession();
  session.type = 'message-created';
  delete session.getInternal;
  session.onebot = { post_type: 'message', message_type: 'group', group_id: 30000 };
  await ctx.middlewares[0](session, async () => undefined);

  assert.equal(logs.some((entry) => entry.message === 'shadow_event'), true);
});

test('shadow Koishi plugin never initializes Yuno runtime or sends replies', async () => {
  const ctx = createContext();
  let initialized = 0;
  let conversations = 0;
  createYunoKoishiPlugin({
    mode: 'shadow',
    config: { selfQq: '10000', adminQq: '90000', yunoPluginMode: 'shadow' },
    initializeYunoRuntime: async () => { initialized += 1; },
    runYunoConversation: async () => { conversations += 1; },
  })(ctx);

  await ctx.handlers.ready[0]();
  await ctx.middlewares[0](groupSession(), async () => undefined);

  assert.equal(initialized, 0);
  assert.equal(conversations, 0);
});
