import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstrBotYunoHttpPlugin } from './src/astrbot-yuno-http-plugin.js';

test('AstrBot HTTP plugin sends normalized capture requests and maps outputs', async () => {
  const calls = [];
  const plugin = createAstrBotYunoHttpPlugin({
    yunoApiUrl: 'http://yuno.invalid:3000',
    yunoApiSecret: 'secret-1',
    requestTimeout: 1234,
    httpClient: {
      post: async (...args) => {
        calls.push(args);
        return {
          data: {
            response: {
              text: 'same text',
              outputs: [{ type: 'text', text: 'same text' }, { type: 'image', image: 'x' }],
              voices: [{ file: 'voice.silk' }],
            },
            outputs: {
              replies: [{ type: 'text', text: 'same text' }, { type: 'text', text: 'second text' }],
            },
            analysis: { reason: 'private-default-reply' },
            event: { chatType: 'private', chatId: '10001' },
          },
        };
      },
      get: async () => ({ data: 'ok' }),
    },
  });

  const result = await plugin.onMessage({
    platform: 'qq',
    scene: 'private',
    userId: '10001',
    username: 'Alice',
    message: 'hello',
    messageId: 'm-1',
    timestamp: 123,
  });

  assert.equal(result.plugin, 'yuno-http-entry');
  assert.equal(result.text, 'same text\nsecond text');
  assert.deepEqual(result.outputs, [
    { type: 'text', text: 'same text' },
    { type: 'image', image: 'x' },
  ]);
  assert.deepEqual(result.voices, [{ file: 'voice.silk' }]);
  assert.deepEqual(result.analysis, { reason: 'private-default-reply' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'http://yuno.invalid:3000/api/yuno/conversation');
  assert.deepEqual(calls[0][1].input.metadata.messageId, 'm-1');
  assert.equal(calls[0][1].responseMode, 'capture');
  assert.deepEqual(calls[0][2], {
    headers: { 'Content-Type': 'application/json', 'x-yuno-api-secret': 'secret-1' },
    timeout: 1234,
  });
});

test('AstrBot HTTP plugin bypasses command handlers without network calls', async () => {
  let postCount = 0;
  const plugin = createAstrBotYunoHttpPlugin({
    httpClient: {
      post: async () => { postCount += 1; },
      get: async () => ({ data: 'ok' }),
    },
  });

  const result = await plugin.onMessage({
    message: '/help',
    activatedHandlers: [{ eventFilters: [{ type: 'CommandFilter' }] }],
  });

  assert.equal(result, null);
  assert.equal(postCount, 0);
});

test('AstrBot HTTP plugin returns null for suppressed or empty replies', async () => {
  for (const data of [{ suppressed: true }, { response: {}, outputs: { replies: [] } }]) {
    const plugin = createAstrBotYunoHttpPlugin({
      httpClient: {
        post: async () => ({ data }),
        get: async () => ({ data: 'ok' }),
      },
    });
    assert.equal(await plugin.onMessage({ message: 'hello', userId: '1' }), null);
  }
});

test('AstrBot HTTP plugin contains API errors and health-check failures', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const plugin = createAstrBotYunoHttpPlugin({
      httpClient: {
        post: async () => {
          const error = new Error('bad gateway');
          error.response = { status: 502, data: { error: 'upstream' } };
          throw error;
        },
        get: async () => { throw new Error('health unavailable'); },
      },
    });
    await plugin.onLoad();
    assert.equal(await plugin.onMessage({ message: 'hello', userId: '1' }), null);
    assert.equal(warnings.some((message) => message.includes('健康检查失败')), true);
  } finally {
    console.warn = originalWarn;
  }
});
