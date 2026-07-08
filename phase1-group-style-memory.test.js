import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeGroupStylePrompt,
  updateGroupStyleProfile,
} from './src/group-style-memory.js';
import { buildReplyContext } from './src/prompt-builder.js';

test('updateGroupStyleProfile tracks short meme-heavy group style', () => {
  let profile = updateGroupStyleProfile(null, {
    text: '笑死，这也太抽象了www',
    analysis: { sentiment: 'positive', topics: ['抽象'] },
  });
  profile = updateGroupStyleProfile(profile, {
    text: '蚌埠住了，确实离谱',
    analysis: { sentiment: 'positive', topics: ['离谱'] },
  });

  assert.equal(profile.replyLength, 'short');
  assert.equal(profile.humorStyle, 'meme-heavy');
  assert.equal(profile.sampleCount, 2);
  assert.match(summarizeGroupStylePrompt(profile), /短句/);
  assert.match(summarizeGroupStylePrompt(profile), /玩梗/);
});

test('buildReplyContext includes group style profile when available', () => {
  const prompt = buildReplyContext({
    event: { platform: 'qq', chatType: 'group', userName: 'Alice' },
    route: { category: 'group_chat', allowFollowUp: false },
    relation: { affection: 40, memorySummary: '' },
    userState: { currentEmotion: 'CALM' },
    userProfile: { profileSummary: '', favoriteTopics: [], dislikes: [] },
    conversationState: { rollingSummary: '', messages: [] },
    groupState: {
      mood: 'CALM',
      activityLevel: 40,
      recentTopics: ['抽象'],
      styleProfile: {
        replyLength: 'short',
        humorStyle: 'meme-heavy',
        expressiveStyle: 'text-emote',
        promptSummary: '群风格偏短句，玩梗密度高，常用文字表情。',
      },
    },
    recentEvents: [],
    messageAnalysis: { intent: 'chat', sentiment: 'positive', relevance: 0.9, ruleSignals: ['direct-mention'] },
    emotionResult: { emotion: 'CALM', intensity: 0.4, toneHints: [] },
    knowledge: { documents: [] },
    isAdmin: false,
    replyLengthProfile: {
      tier: 'balanced',
      maxTokens: 240,
      historyLimit: 3,
      promptProfile: 'standard',
      performanceProfile: 'standard_chat',
      guidance: '群聊短接话。',
    },
    replyPlan: { type: 'direct', depth: 'short', questionNeeded: false },
  });

  assert.match(prompt, /群风格=群风格偏短句，玩梗密度高/);
});
