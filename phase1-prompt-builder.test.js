import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplyContext } from './src/prompt-builder.js';

test('buildReplyContext injects special-user persona and diary memory cues', () => {
  const prompt = buildReplyContext({
    event: { platform: 'qq', chatType: 'private', userName: 'Scathach' },
    route: { category: 'private_chat', allowFollowUp: true },
    relation: { affection: 95, memorySummary: 'Special target: Scathach; activity: 90' },
    userState: { currentEmotion: 'FIXATED' },
    userProfile: {
      profileSummary: 'Prefers a softer and more attached tone.',
      preferredName: 'Master',
      favoriteTopics: ['guidance'],
      dislikes: ['distance'],
      specialBondSummary: 'Special relationship target: Scathach; shared memory: promise.',
      specialNicknames: ['Master'],
      bondMemories: ['promise', 'guidance'],
    },
    conversationState: {
      rollingSummary: 'Last time they talked about a promise.',
      messages: [{ role: 'user', content: 'Do you still remember?' }],
    },
    groupState: null,
    recentEvents: [],
    messageAnalysis: { intent: 'chat', sentiment: 'positive', relevance: 0.9, ruleSignals: ['special-user'] },
    emotionResult: { intensity: 0.92, promptStyle: 'focused and attached', toneHints: ['possessive', 'remembers details'] },
    knowledge: { documents: [] },
    isAdmin: false,
    specialUser: {
      label: 'Scathach',
      personaMode: 'exclusive_adoration',
      toneMode: 'flirtatious_favorite',
      addressUserAs: 'Scathach',
      privateStyle: 'More attached and intimate in private chat.',
      groupStyle: 'More restrained and protective in group chat.',
    },
    replyLengthProfile: {
      tier: 'expanded',
      maxTokens: 520,
      historyLimit: 6,
      promptProfile: 'standard',
      guidance: 'Give a fuller and emotionally complete reply.',
    },
  });

  assert.match(prompt, /Special User Override/);
  assert.match(prompt, /Scathach/);
  assert.match(prompt, /Diary-style Memory Cue/);
  assert.match(prompt, /specialBondSummary=/);
  assert.match(prompt, /real-world threats|real-world threat/i);
});
