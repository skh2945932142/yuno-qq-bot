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
    rawText: 'what can you do?',
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: null,
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'private-default-reply');
});

test('analyzeTrigger suppresses group chatter without explicit trigger', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '10001',
    userName: 'Alice',
    rawText: 'what should we eat today',
    mentionsBot: false,
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 10 },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'explicit-trigger-required');
});

test('special user trigger keywords count as explicit group triggers', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '20001',
    userName: 'Scathach',
    rawText: '师父，教导我',
    mentionsBot: false,
  }, {
    relation: { affection: 88, activeScore: 72 },
    userProfile: { bondMemories: ['约定'], specialNicknames: ['师父'] },
    groupState: { activityLevel: 20 },
    specialUser: {
      userId: '20001',
      label: 'Scathach',
      affectionFloor: 88,
      triggerKeywords: ['教导我', '师父'],
      memorySeeds: ['约定'],
    },
  }, {
    triggerPolicy: {
      keywords: [],
    },
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'special-keyword-trigger');
  assert.match(result.ruleSignals.join(','), /special-user/);
  assert.match(result.ruleSignals.join(','), /special-keyword/);
});

test('jealousy topics are detected for special users', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'private',
    chatId: 'u1',
    userId: '20001',
    userName: 'Scathach',
    rawText: '你别看别人了',
  }, {
    relation: { affection: 90, activeScore: 80 },
    groupState: null,
    specialUser: {
      userId: '20001',
      label: 'Scathach',
      affectionFloor: 88,
      triggerKeywords: ['教导我'],
      memorySeeds: [],
    },
  });

  assert.equal(result.shouldRespond, true);
  assert.match(result.ruleSignals.join(','), /jealousy-topic/);
});
