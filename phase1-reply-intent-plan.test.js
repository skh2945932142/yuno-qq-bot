import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReplyIntentPlan } from './src/reply-intent-plan.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: 'u1',
    userId: 'u1',
    userName: 'Alice',
    ...overrides,
  };
}

test('private follow-up prefers direct_followup with question', () => {
  const plan = resolveReplyIntentPlan({
    event: createEvent({ chatType: 'private' }),
    route: { category: 'follow_up' },
    analysis: { intent: 'chat', sentiment: 'neutral', relevance: 0.88 },
    conversationState: { messages: [{}, {}, {}] },
  });

  assert.equal(plan.type, 'direct_followup');
  assert.equal(plan.depth, 'medium');
  assert.equal(plan.questionNeeded, true);
});

test('private supportive scene prefers empathic_followup', () => {
  const plan = resolveReplyIntentPlan({
    event: createEvent({ chatType: 'private' }),
    route: { category: 'private_chat' },
    analysis: { intent: 'help', sentiment: 'negative', relevance: 0.9 },
    conversationState: { rollingSummary: '对方状态低落', messages: [{}, {}] },
  });

  assert.equal(plan.type, 'empathic_followup');
  assert.equal(plan.questionNeeded, true);
});

test('group default stays conservative', () => {
  const plan = resolveReplyIntentPlan({
    event: createEvent({ chatType: 'group', chatId: 'g1' }),
    route: { category: 'group_chat' },
    analysis: { intent: 'chat', sentiment: 'neutral', relevance: 0.4 },
    conversationState: { messages: [] },
  });

  assert.equal(plan.type, 'direct');
  assert.equal(plan.depth, 'short');
});

