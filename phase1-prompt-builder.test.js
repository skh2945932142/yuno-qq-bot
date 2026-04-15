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
      performanceProfile: 'standard_chat',
      guidance: '这一轮可以写得更完整。私聊先回答，再顺一层情绪或细节，必要时轻轻追问。',
    },
  });

  assert.match(prompt, /默认使用中文/);
  assert.match(prompt, /特殊对象/);
  assert.match(prompt, /Scathach/);
  assert.match(prompt, /记忆/);
  assert.match(prompt, /特殊羁绊=/);
  assert.match(prompt, /现实威胁|暴力/);
});

test('buildReplyContext trims non-essential sections in fast_chat mode', () => {
  const prompt = buildReplyContext({
    event: { platform: 'qq', chatType: 'group', userName: 'Alice' },
    route: { category: 'group_chat', allowFollowUp: false },
    relation: { affection: 60, memorySummary: '普通但稳定的聊天对象。' },
    userState: { currentEmotion: 'CALM' },
    userProfile: {
      profileSummary: '更喜欢自然一点的群聊节奏。',
      preferredName: '',
      favoriteTopics: ['日常'],
      dislikes: [],
    },
    conversationState: {
      rollingSummary: '',
      messages: [{ role: 'user', content: '今晚还在吗？' }],
    },
    groupState: { mood: 'CALM', activityLevel: 24, recentTopics: ['日常'] },
    recentEvents: [{ summary: '群里刚才主要在闲聊。' }],
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', relevance: 0.52, ruleSignals: ['direct-mention'] },
    emotionResult: { intensity: 0.35, promptStyle: 'natural', toneHints: ['轻一点'] },
    knowledge: { documents: [] },
    isAdmin: false,
    specialUser: null,
    replyLengthProfile: {
      tier: 'balanced',
      maxTokens: 240,
      historyLimit: 2,
      promptProfile: 'fast',
      performanceProfile: 'fast_chat',
      guidance: '这是轻量群聊回复。先接话，再补一句态度，2 到 3 句内收住，不要拖成长段。',
    },
  });

  assert.match(prompt, /轻量群聊回复/);
  assert.doesNotMatch(prompt, /知识\n/);
  assert.doesNotMatch(prompt, /最近群事件/);
});
