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

test('special user still replies when an explicit trigger keyword is present', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '20001',
    userName: 'Scathach',
    rawText: 'help teach me',
    mentionsBot: false,
  }, {
    relation: { affection: 88, activeScore: 72 },
    userProfile: { bondMemories: ['teach'], specialNicknames: ['master'] },
    groupState: { activityLevel: 20 },
    specialUser: {
      userId: '20001',
      label: 'Scathach',
      affectionFloor: 88,
      triggerKeywords: ['teach', 'master'],
      memorySeeds: ['teach'],
    },
  }, {
    triggerPolicy: {
      keywords: ['help', 'teach'],
    },
  });

  assert.equal(result.shouldRespond, true);
  assert.match(result.ruleSignals.join(','), /special-user/);
  assert.match(result.ruleSignals.join(','), /special-keyword|keyword/);
});
