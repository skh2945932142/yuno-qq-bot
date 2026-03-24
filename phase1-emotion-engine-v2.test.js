import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmotion, shouldSendVoiceForEmotion } from './src/emotion-engine.js';

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
