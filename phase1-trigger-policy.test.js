import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrigger } from './src/message-analysis.js';
import { config } from './src/config.js';

test('trigger policy override can suppress classifier and deny borderline chatter', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '10001',
    userName: 'Alice',
    rawText: '有问题想问你',
    mentionsBot: false,
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 10 },
  }, {
    triggerPolicy: {
      classifier: { enabled: false },
      groupChat: {
        autoAllowThreshold: 0.95,
        requireClassifierWindow: { minScore: 0.9, maxScore: 0.94 },
      },
    },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'group-low-confidence');
});

test('group admin question can pass without direct mention under mixed policy', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: config.adminQq || '10001',
    userName: 'Admin',
    rawText: '这个设定怎么用',
    mentionsBot: false,
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 10 },
  }, {
    triggerClassifier: async () => ({
      shouldRespond: true,
      confidence: 0.9,
      category: 'info_query',
      reason: 'test-classifier',
    }),
  });

  assert.equal(result.shouldRespond, true);
  assert.match(result.reason, /admin-priority-pass|classifier-allow/);
});
