import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrigger } from './src/message-analysis.js';
import { config } from './src/config.js';

test('trigger policy override can disable explicit trigger gate', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '10001',
    userName: 'Alice',
    rawText: 'can you answer something',
    mentionsBot: false,
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 10 },
  }, {
    triggerPolicy: {
      classifier: { enabled: false },
      groupChat: {
        requireExplicitTrigger: false,
        autoAllowThreshold: 0.95,
        requireClassifierWindow: { minScore: 0.9, maxScore: 0.94 },
      },
    },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'group-low-confidence');
});

test('group admin plain question is still suppressed without explicit trigger', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: config.adminQq || '10001',
    userName: 'Admin',
    rawText: 'how should this work today',
    mentionsBot: false,
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 10 },
  }, {
    triggerPolicy: {
      keywords: ['help'],
    },
    triggerClassifier: async () => ({
      shouldRespond: true,
      confidence: 0.9,
      category: 'info_query',
      reason: 'test-classifier',
    }),
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'explicit-trigger-required');
});

test('group admin command still counts as explicit trigger', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: config.adminQq || '10001',
    userName: 'Admin',
    rawText: '/help',
    mentionsBot: false,
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 10 },
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'command-trigger');
});

