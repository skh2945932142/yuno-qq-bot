import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptAstrBotMessage, createAstrBotYunoPlugin, extractYunoReplyPayload } from './src/astrbot-yuno-plugin.js';

test('adaptAstrBotMessage converts AstrBot-style context into Yuno input', () => {
  const input = adaptAstrBotMessage({
    platform: 'qq',
    scene: 'group',
    groupId: '200',
    userId: '100',
    username: 'Alice',
    message: 'hello',
    messageId: 'm-1',
  });

  assert.equal(input.platform, 'qq');
  assert.equal(input.scene, 'group');
  assert.equal(input.groupId, '200');
  assert.equal(input.chatId, '200');
  assert.equal(input.userId, '100');
  assert.equal(input.rawMessage, 'hello');
  assert.equal(input.metadata.adapter, 'astrbot');
});

test('createAstrBotYunoPlugin returns structured output from routed Yuno Core', async () => {
  const plugin = createAstrBotYunoPlugin({
    router: {
      route: async () => ({
        plugin: 'yuno-chat',
        suppressed: false,
        response: { text: 'Yuno is here.', voices: [], outputs: [{ type: 'text', text: 'Yuno is here.' }] },
        analysis: { reason: 'test' },
        event: { chatType: 'private', chatId: '100' },
      }),
    },
  });

  const result = await plugin.onMessage({
    platform: 'qq',
    scene: 'private',
    userId: '100',
    username: 'Alice',
    message: 'ping',
  });

  assert.equal(result.text, 'Yuno is here.');
  assert.equal(result.plugin, 'yuno-chat');
  assert.equal(result.analysis.reason, 'test');
});

test('createAstrBotYunoPlugin bypasses AstrBot command handlers', async () => {
  let routeCalled = false;
  const plugin = createAstrBotYunoPlugin({
    router: {
      route: async () => {
        routeCalled = true;
        return {
          plugin: 'yuno-chat',
          suppressed: false,
          response: { text: 'should not run' },
        };
      },
    },
  });

  const result = await plugin.onMessage({
    platform: 'qq',
    scene: 'private',
    userId: '100',
    username: 'Alice',
    message: '/表情管理 开启管理后台',
    activatedHandlers: [
      {
        pluginName: 'meme_manager',
        handlerName: 'start_webui',
        eventFilters: [{ type: 'CommandFilter' }],
      },
    ],
  });

  assert.equal(result, null);
  assert.equal(routeCalled, false);
});

test('extractYunoReplyPayload supports capture-mode outputs without legacy response text', () => {
  const reply = extractYunoReplyPayload({
    ok: true,
    suppressed: false,
    outputs: {
      replies: [
        {
          type: 'text',
          target: { platform: 'qq', chatType: 'private', chatId: '100' },
          text: 'capture reply',
        },
      ],
      voices: [],
      outputs: [],
    },
  });

  assert.equal(reply.text, 'capture reply');
  assert.equal(reply.outputs[0].type, 'text');
});
