import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDailyMood } from '../src/daily-mood.js';
import { resolveEmotion } from '../src/emotion-engine.js';

test('resolveDailyMood is stable for the same natural day and seed', () => {
  const first = resolveDailyMood({
    now: new Date('2026-07-20T01:00:00+08:00'),
    timeZone: 'Asia/Shanghai',
    seed: 'stable-test',
  });
  const second = resolveDailyMood({
    now: new Date('2026-07-20T22:00:00+08:00'),
    timeZone: 'Asia/Shanghai',
    seed: 'stable-test',
  });

  assert.equal(first.dateKey, '2026-07-20');
  assert.equal(second.key, first.key);
});

test('daily irritable mood overrides affectionate baseline at high affection', () => {
  const dailyMood = resolveDailyMood({
    now: new Date('2026-07-20T12:00:00+08:00'),
    override: 'IRRITABLE',
  });
  const result = resolveEmotion({
    relation: { affection: 98 },
    userState: { intensity: 0.4, currentEmotion: 'AFFECTIONATE' },
    groupState: { mood: 'CALM', activityLevel: 10 },
    messageAnalysis: {
      intent: 'chat',
      sentiment: 'positive',
      confidence: 0.8,
      ruleSignals: [],
    },
    specialUser: { affectionFloor: 88 },
    dailyMood,
  });

  assert.equal(result.emotion, 'ANGRY');
  assert.equal(result.reason, 'daily-mood:irritable');
  assert.equal(result.dailyMood.antiPleasing, true);
  assert.match(result.toneHints.join(' '), /不讨好/);
});

test('disabled daily mood returns no global mood constraint', () => {
  assert.equal(resolveDailyMood({ enabled: false }), null);
});

test('invalid daily mood timezone falls back without breaking mood selection', () => {
  const mood = resolveDailyMood({
    now: new Date('2026-07-20T12:00:00+08:00'),
    timeZone: 'invalid/timezone',
    seed: 'timezone-test',
  });

  assert.equal(mood.dateKey, '2026-07-20');
  assert.ok(mood.key);
});
