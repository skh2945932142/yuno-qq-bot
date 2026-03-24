import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstrBotPluginRouter } from './src/astrbot-plugin-router.js';

test('astrbot router applies plugin priority order and returns first handled result', async () => {
  const handled = [];
  const router = createAstrBotPluginRouter({
    plugins: [
      {
        name: 'observe-only',
        priority: 10,
        observe: async () => {
          handled.push('observe');
        },
        match: () => false,
        handle: async () => null,
      },
      {
        name: 'first-match',
        priority: 20,
        match: () => true,
        handle: async () => {
          handled.push('first');
          return {
            suppressed: false,
            response: { text: 'first' },
          };
        },
      },
      {
        name: 'second-match',
        priority: 30,
        match: () => true,
        handle: async () => {
          handled.push('second');
          return {
            suppressed: false,
            response: { text: 'second' },
          };
        },
      },
    ],
  });

  const result = await router.route({
    input: {
      platform: 'qq',
      scene: 'group',
      userId: '100',
      groupId: '200',
      chatId: '200',
      username: 'Alice',
      rawMessage: '/help',
      metadata: {},
    },
  });

  assert.equal(result.plugin, 'first-match');
  assert.deepEqual(handled, ['observe', 'first']);
});
