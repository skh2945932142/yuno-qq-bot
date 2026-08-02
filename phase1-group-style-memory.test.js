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

test('group style stays adaptive after a very long history', () => {
  // sampleCount used to grow without bound, so the learning rate decayed to 1/n
  // and the profile froze: with 50k samples, 60 new messages moved averageLength
  // by less than 0.1. The effective weight is now capped, turning this into an
  // exponential moving average with a bounded time constant.
  const saturated = {
    sampleCount: 50000,
    averageLength: 10,
    memeRate: 0,
    emojiRate: 0,
    textEmoteRate: 0,
  };
  const longMessage = '这是一条明显更长的群消息，用来验证平均长度还能被新样本带动'.repeat(2);

  const advance = (profile, times) => {
    let next = profile;
    for (let index = 0; index < times; index += 1) {
      next = updateGroupStyleProfile(next, { text: longMessage, analysis: { topics: [] } });
    }
    return next;
  };

  const after60 = advance(saturated, 60);
  assert.ok(
    after60.averageLength > 18,
    `averageLength should follow new samples, got ${after60.averageLength}`
  );

  const after300 = advance(saturated, 300);
  assert.ok(after300.averageLength > after60.averageLength);
  assert.equal(after300.replyLength, 'balanced');
});
