import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmotion, shouldSendVoiceForEmotion } from '../src/services/emotion-engine.js';

test('resolveEmotion picks protective for help requests with decent affection', () => {
  const result = resolveEmotion({
    relation: { affection: 72 },
    userState: { intensity: 0.4 },
    groupState: { mood: 'CALM', activityLevel: 20 },
    messageAnalysis: {
      intent: 'help',
      sentiment: 'neutral',
      confidence: 0.8,
      relevance: 0.8,
    },
  });

  assert.equal(result.emotion, 'PROTECTIVE');
  assert.equal(result.reason, 'help-request');
});

test('resolveEmotion becomes angry on hostile low-affection input', () => {
  const result = resolveEmotion({
    relation: { affection: 10 },
    userState: { intensity: 0.3 },
    groupState: { mood: 'WARN', activityLevel: 50 },
    messageAnalysis: {
      intent: 'challenge',
      sentiment: 'negative',
      confidence: 0.9,
      relevance: 0.8,
    },
  });

  assert.equal(result.emotion, 'ANGRY');
  assert.equal(shouldSendVoiceForEmotion(result), true);
});
