import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrigger } from '../src/services/analysis.js';
import { config } from '../src/config.js';

function createEvent(overrides = {}) {
  return {
    group_id: 'non-target-group',
    user_id: '10001',
    self_id: '20002',
    raw_message: '由乃 你好',
    ...overrides,
  };
}

test('analyzeTrigger passes direct mention in basic mode', async () => {
  const result = await analyzeTrigger(createEvent({
    raw_message: '[CQ:at,qq=20002] 帮我看看这个问题',
  }), {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 20 },
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.intent, 'help');
  assert.equal(result.reason, 'basic-direct-mention-pass');
  assert.match(result.ruleSignals.join(','), /direct-mention/);
});

test('analyzeTrigger suppresses non-mentioned chatter in basic mode', async () => {
  const result = await analyzeTrigger(createEvent({
    raw_message: '今天天气一般',
  }), {
    relation: { affection: 20, activeScore: 5 },
    groupState: { activityLevel: 10 },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'direct-mention-required');
});

test('analyzeTrigger skips llm analysis for direct mentions in advanced mode', async () => {
  let analyzerCalls = 0;

  const result = await analyzeTrigger(createEvent({
    group_id: config.targetGroupId,
    raw_message: '[CQ:at,qq=20002] 帮我看看状态',
  }), {
    relation: { affection: 40, activeScore: 15 },
    groupState: { activityLevel: 20 },
  }, {
    messageAnalyzer: async () => {
      analyzerCalls += 1;
      return {
        intent: 'help',
        sentiment: 'neutral',
        relevance: 1,
        confidence: 1,
        shouldReply: true,
        reason: 'llm-analysis',
        topics: [],
        replyStyle: 'calm',
      };
    },
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'advanced-direct-mention-pass');
  assert.equal(analyzerCalls, 0);
});

test('analyzeTrigger suppresses CQ conversations that mention only other users', async () => {
  const result = await analyzeTrigger(createEvent({
    raw_message: '[CQ:at,qq=30003] 你们继续聊',
  }), {
    relation: { affection: 50, activeScore: 10 },
    groupState: { activityLevel: 20 },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'direct-mention-required');
});

test('analyzeTrigger suppresses plain text @someone conversations', async () => {
  const result = await analyzeTrigger(createEvent({
    raw_message: '@小王 你先说',
  }), {
    relation: { affection: 50, activeScore: 10 },
    groupState: { activityLevel: 20 },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'direct-mention-required');
});

test('analyzeTrigger suppresses scathach harm cues without direct mention', async () => {
  const result = await analyzeTrigger(createEvent({
    raw_message: '[CQ:at,qq=30003] 斯卡哈受伤了 快来帮忙',
  }), {
    relation: { affection: 35, activeScore: 10 },
    groupState: { activityLevel: 20 },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'direct-mention-required');
});
