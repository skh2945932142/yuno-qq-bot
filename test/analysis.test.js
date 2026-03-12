import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrigger } from '../src/services/analysis.js';

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
  assert.match(result.ruleSignals.join(','), /direct-mention/);
});

test('analyzeTrigger suppresses weak chatter in basic mode', async () => {
  const result = await analyzeTrigger(createEvent({
    raw_message: '今天天气一般',
  }), {
    relation: { affection: 20, activeScore: 5 },
    groupState: { activityLevel: 10 },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'basic-rule-skip');
});
