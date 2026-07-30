import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmotion, shouldSendVoiceForEmotion } from './src/emotion-engine.js';
import { listDailyMoodProfiles } from './src/daily-mood.js';

test('resolveEmotion enters FIXATED for special users with high affection', () => {
  const result = resolveEmotion({
    relation: { affection: 92 },
    userState: { intensity: 0.4, currentEmotion: 'AFFECTIONATE' },
    groupState: { activityLevel: 12, mood: 'CALM' },
    messageAnalysis: {
      confidence: 0.88,
      intent: 'social',
      sentiment: 'positive',
      ruleSignals: ['special-user', 'special-keyword'],
    },
    specialUser: { affectionFloor: 88 },
  });

  assert.equal(result.emotion, 'FIXATED');
  assert.equal(shouldSendVoiceForEmotion(result), true);
});

test('resolveEmotion enters JEALOUS when special-user jealousy topics are mentioned', () => {
  const result = resolveEmotion({
    relation: { affection: 90 },
    userState: { intensity: 0.35, currentEmotion: 'CALM' },
    groupState: { activityLevel: 55, mood: 'CALM' },
    messageAnalysis: {
      confidence: 0.82,
      intent: 'chat',
      sentiment: 'neutral',
      ruleSignals: ['special-user', 'jealousy-topic'],
    },
    specialUser: { affectionFloor: 88 },
  });

  assert.equal(result.emotion, 'JEALOUS');
  assert.equal(result.reason, 'special-jealousy');
});

test('daily mood changes intensity and presentation without overriding contextual affection', () => {
  const result = resolveEmotion({
    relation: { affection: 94 },
    userState: { intensity: 0.4, currentEmotion: 'AFFECTIONATE' },
    groupState: null,
    messageAnalysis: {
      confidence: 0.9,
      intent: 'social',
      sentiment: 'positive',
      ruleSignals: ['special-user'],
    },
    specialUser: { affectionFloor: 88 },
    dailyMood: {
      key: 'GLOOMY',
      intensityBoost: 0.03,
      promptStyle: '今天亮度偏低，但仍然接得住亲近。',
      toneHints: ['低落'],
    },
  });

  assert.equal(result.emotion, 'FIXATED');
  assert.equal(result.reason, 'positive-message');
  assert.match(result.promptStyle, /接得住亲近/);
});

test('daily mood weights match the quiet-cold distribution and total one hundred', () => {
  const profiles = listDailyMoodProfiles();
  assert.equal(profiles.reduce((sum, profile) => sum + profile.weight, 0), 100);
  assert.deepEqual(Object.fromEntries(profiles.map((profile) => [profile.key, profile.weight])), {
    STEADY: 22,
    DISTANT: 16,
    GLOOMY: 12,
    CURIOUS: 12,
    SHY: 11,
    PROTECTIVE: 10,
    BRIGHT: 8,
    PLAYFUL: 5,
    IRRITABLE: 3,
    JEALOUS: 1,
  });
});
test('soft emotions keep a one-emoji budget while sharp emotions stay text-only', () => {
  const soft = [
    { emotion: 'CALM', input: { relation: { affection: 30 }, messageAnalysis: { intent: 'chat', sentiment: 'neutral', confidence: 0.6, ruleSignals: [] } } },
    { emotion: 'PROTECTIVE', input: { relation: { affection: 72 }, messageAnalysis: { intent: 'help', sentiment: 'neutral', confidence: 0.8, relevance: 0.8, ruleSignals: [] } } },
    { emotion: 'JEALOUS', input: { relation: { affection: 90 }, specialUser: { affectionFloor: 88 }, messageAnalysis: { intent: 'chat', sentiment: 'neutral', confidence: 0.82, ruleSignals: ['special-user', 'jealousy-topic'] } } },
    { emotion: 'SAD', input: { relation: { affection: 50 }, messageAnalysis: { intent: 'chat', sentiment: 'negative', confidence: 0.7, ruleSignals: ['cold-shoulder'] } } },
  ];

  for (const entry of soft) {
    const result = resolveEmotion({
      userState: { intensity: 0.4 },
      groupState: { mood: 'CALM', activityLevel: 20 },
      ...entry.input,
    });
    if (result.emotion !== entry.emotion) continue;
    assert.equal(result.emojiBudget, 1, `${entry.emotion} budget`);
    assert.equal(result.emojiStyle, 'soft', `${entry.emotion} style`);
  }

  const angry = resolveEmotion({
    relation: { affection: 10 },
    userState: { intensity: 0.3 },
    groupState: { mood: 'WARN', activityLevel: 50 },
    messageAnalysis: { intent: 'challenge', sentiment: 'negative', confidence: 0.9, relevance: 0.8, ruleSignals: [] },
  });
  assert.equal(angry.emotion, 'ANGRY');
  assert.equal(angry.emojiBudget, 0);
  assert.equal(angry.emojiStyle, 'none');
});
