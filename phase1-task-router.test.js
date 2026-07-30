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

test('planIncomingTask identifies follow-up prompts', () => {
  const task = planIncomingTask({
    event: createEvent({ rawText: '然后呢' }),
    text: '然后呢',
    analysis: { shouldRespond: true, reason: 'private-default-reply' },
    conversationState: { messages: [{ role: 'user', content: '先前聊过' }] },
  });

  assert.equal(task.category, 'follow_up');
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
test('planIncomingTask routes ambient join into group chat without follow-up', () => {
  const task = planIncomingTask({
    event: createEvent({ chatType: 'group', chatId: '20001', rawText: '这个方案我觉得还行' }),
    text: '这个方案我觉得还行',
    analysis: { shouldRespond: true, reason: 'ambient-join', relevance: 0.45 },
    conversationState: { messages: [{ role: 'user', content: '之前聊过' }, { role: 'assistant', content: '嗯' }] },
  });

  assert.equal(task.type, 'chat');
  assert.equal(task.category, 'group_chat');
  assert.equal(task.requiresRetrieval, false);
  assert.equal(task.allowFollowUp, false);
  assert.equal(task.reason, 'ambient-join');
});
