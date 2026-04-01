import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrigger } from '../src/message-analysis.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'group',
    chatId: 'group-1',
    userId: 'user-1',
    userName: 'Tester',
    text: 'hello there',
    rawText: 'hello there',
    mentionsBot: false,
    messageId: 'msg-1',
    ...overrides,
  };
}

function createContext(overrides = {}) {
  return {
    relation: { affection: 40, activeScore: 10, userId: 'user-1' },
    userState: { currentEmotion: 'CALM', intensity: 0.3 },
    conversationState: { messages: [], rollingSummary: '' },
    specialUser: null,
    isAdmin: false,
    ...overrides,
  };
}

test('analyzeTrigger passes direct mention in group chat', async () => {
  const event = createEvent({
    mentionsBot: true,
    rawText: '[CQ:at,qq=123] help me please',
    text: 'help me please',
  });

  const result = await analyzeTrigger(event, createContext());
  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'basic-direct-mention-pass');
  assert.match(result.ruleSignals.join(','), /direct-mention/);
});

test('analyzeTrigger suppresses non-explicit group chatter', async () => {
  const result = await analyzeTrigger(createEvent({
    rawText: 'just chatting',
    text: 'just chatting',
  }), createContext());

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'explicit-trigger-required');
});

test('analyzeTrigger defaults to replying in private chat', async () => {
  const result = await analyzeTrigger(createEvent({
    chatType: 'private',
    chatId: 'user-1',
    rawText: 'you there',
    text: 'you there',
  }), createContext());

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'private-default-reply');
});
