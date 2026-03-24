import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptAstrBotMessage, createAstrBotYunoPlugin } from './src/astrbot-yuno-plugin.js';

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
