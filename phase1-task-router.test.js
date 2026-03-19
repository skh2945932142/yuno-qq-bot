import test from 'node:test';
import assert from 'node:assert/strict';
import { planIncomingTask } from './src/task-router.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    rawText: '你好',
    ...overrides,
  };
}

test('planIncomingTask routes knowledge questions to retrieval', () => {
  const task = planIncomingTask({
    event: createEvent({ rawText: '你的设定是什么' }),
    text: '你的设定是什么',
    analysis: { shouldRespond: true, reason: 'private-default-reply' },
    conversationState: { messages: [] },
  });

  assert.equal(task.category, 'knowledge_qa');
  assert.equal(task.requiresRetrieval, true);
});

test('planIncomingTask identifies cold-start prompts', () => {
  const task = planIncomingTask({
    event: createEvent({ rawText: '无聊' }),
    text: '无聊',
    analysis: { shouldRespond: true, reason: 'private-default-reply' },
    conversationState: { messages: [] },
  });

  assert.equal(task.category, 'cold_start');
});

test('planIncomingTask uses group/private defaults when no special route matches', () => {
  const privateTask = planIncomingTask({
    event: createEvent({ rawText: '今天好累' }),
    text: '今天好累',
    analysis: { shouldRespond: true, reason: 'private-default-reply' },
    conversationState: { messages: [] },
  });
  const groupTask = planIncomingTask({
    event: createEvent({
      chatType: 'group',
      chatId: '12345',
      rawText: '[CQ:at,qq=20002] 今天好累',
    }),
    text: '[CQ:at,qq=20002] 今天好累',
    analysis: { shouldRespond: true, reason: 'basic-direct-mention-pass' },
    conversationState: { messages: [] },
  });

  assert.equal(privateTask.category, 'private_chat');
  assert.equal(groupTask.category, 'group_chat');
});
