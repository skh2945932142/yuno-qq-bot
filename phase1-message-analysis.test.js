import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrigger } from './src/message-analysis.js';

test('analyzeTrigger defaults to replying in private chat', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    userName: 'Alice',
    rawText: '你会什么',
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: null,
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'private-default-reply');
});

test('analyzeTrigger still suppresses unmentioned group chatter', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '10001',
    userName: 'Alice',
    rawText: '今天吃什么',
    mentionsBot: false,
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 10 },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'direct-mention-required');
});
