import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmotion, shouldSendVoiceForEmotion } from '../src/emotion-engine.js';

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
      ruleSignals: [],
    },
  });

  assert.equal(result.emotion, 'PROTECTIVE');
  assert.equal(result.reason, 'help-request');
  assert.equal(result.emojiBudget, 0);
  assert.equal(result.emojiStyle, 'none');
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
      ruleSignals: [],
    },
  });

  assert.equal(result.emotion, 'ANGRY');
  assert.equal(result.emojiBudget, 0);
  assert.equal(shouldSendVoiceForEmotion(result), true);
});

test('resolveEmotion allows a small soft emoji budget for affectionate state', () => {
  const result = resolveEmotion({
    relation: { affection: 92 },
    userState: { intensity: 0.3 },
    groupState: { mood: 'CALM', activityLevel: 15 },
    messageAnalysis: {
      intent: 'chat',
      sentiment: 'positive',
      confidence: 0.75,
      relevance: 0.7,
      ruleSignals: [],
    },
  });

  assert.equal(result.emotion, 'AFFECTIONATE');
  assert.equal(result.emojiBudget, 1);
  assert.equal(result.emojiStyle, 'soft');
});
