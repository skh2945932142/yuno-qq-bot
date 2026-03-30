import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { validateOnebotMessageEvent } from './src/adapters/onebot-event.js';
import { analyzeTrigger } from './src/message-analysis.js';
import { createApp } from './src/bootstrap-phase1.js';
import { shouldRespondToEvent } from './src/message-workflow.js';
import { setRuntimeServices } from './src/runtime-services.js';

function createPokePayload(overrides = {}) {
  return {
    post_type: 'notice',
    notice_type: 'notify',
    sub_type: 'poke',
    self_id: '999',
    user_id: '10001',
    target_id: '999',
    group_id: '20001',
    time: Date.now(),
    sender: { nickname: 'Alice' },
    ...overrides,
  };
}

test('onebot adapter keeps non-target poke but does not mark it as bot mention', () => {
  const result = validateOnebotMessageEvent(createPokePayload({
    target_id: '777',
  }));

  assert.equal(result.ok, true);
  assert.equal(result.value.chatType, 'group');
  assert.equal(result.value.mentionsBot, false);
  assert.equal(result.value.text, '/poke');
});

test('analyzeTrigger suppresses non-target poke notices', async () => {
  const result = await analyzeTrigger(validateOnebotMessageEvent(createPokePayload({
    target_id: '777',
  })).value);

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'non-target-poke');
});

test('shouldRespondToEvent uses fast path for explicit group triggers without loading workflow context', async () => {
  let contextLoads = 0;

  const decision = await shouldRespondToEvent({
    platform: 'qq',
    chatType: 'group',
    chatId: '20001',
    userId: '10001',
    userName: 'Alice',
    rawText: '[CQ:at,qq=999] 你好',
    text: '你好',
    mentionsBot: true,
    attachments: [],
    timestamp: Date.now(),
    source: { adapter: 'test', postType: 'message' },
    selfId: '999',
  }, {
    deps: {
      ensureRelation: async () => {
        contextLoads += 1;
        return {};
      },
      ensureUserState: async () => {
        contextLoads += 1;
        return {};
      },
      ensureUserProfileMemory: async () => {
        contextLoads += 1;
        return {};
      },
      getConversationState: async () => {
        contextLoads += 1;
        return {};
      },
    },
  });

  assert.equal(decision.analysis.shouldRespond, true);
  assert.equal(contextLoads, 0);
});

test('webhook ignores non-target poke notices before enqueueing reply jobs', async () => {
  const enqueued = [];
  const queueManager = {
    async enqueueReply(payload) {
      enqueued.push(payload);
    },
    getStatus() {
      return { ready: true, mode: 'inline' };
    },
  };

  setRuntimeServices({ queueManager });
  const app = createApp();
  const server = createServer(app);
  server.listen(0);
  await once(server, 'listening');

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/onebot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPokePayload({
        target_id: '777',
      })),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(enqueued.length, 0);
  } finally {
    server.close();
    await once(server, 'close');
    setRuntimeServices({ queueManager: null });
  }
});
