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
    rawText: '你会什么？',
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
  assert.equal(result.reason, 'group-low-confidence');
});

test('analyzeTrigger gives special users a lower reply threshold in group chat', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '20001',
    userName: 'Scathach',
    rawText: '师父，教导我一下',
    mentionsBot: false,
  }, {
    relation: { affection: 88, activeScore: 72 },
    userProfile: { bondMemories: ['教导'], specialNicknames: ['师父'] },
    groupState: { activityLevel: 20 },
    specialUser: {
      userId: '20001',
      label: 'Scathach',
      affectionFloor: 88,
      triggerKeywords: ['教导我', '师父'],
      memorySeeds: ['教导'],
    },
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'special-heuristic-pass');
  assert.match(result.ruleSignals.join(','), /special-user/);
  assert.match(result.ruleSignals.join(','), /special-keyword/);
});
