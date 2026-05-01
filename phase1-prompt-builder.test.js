import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplyContext } from './src/prompt-builder.js';

test('buildReplyContext injects special-user persona and diary memory cues', () => {
  const prompt = buildReplyContext({
    event: { platform: 'qq', chatType: 'private', userName: 'Scathach' },
    route: { category: 'private_chat', allowFollowUp: true },
    relation: { affection: 95, memorySummary: '特殊对象:Scathach；最近互动频率高。' },
    userState: { currentEmotion: 'FIXATED' },
    userProfile: {
      profileSummary: '偏好更依赖、更贴近的回应。',
      preferredName: '师父',
      favoriteTopics: ['指导'],
      dislikes: ['疏离'],
      specialBondSummary: '特殊关系对象:Scathach；共同记忆:约定。',
      specialNicknames: ['师父'],
      bondMemories: ['约定', '指导'],
    },
    conversationState: {
      rollingSummary: '上次聊到了你们的约定。',
      messages: [{ role: 'user', content: '你还记得吗？' }],
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
      privateStyle: '私聊更黏人、更贴近。',
      groupStyle: '群聊更克制但会护短。',
    },
    replyLengthProfile: {
      tier: 'expanded',
      maxTokens: 520,
      historyLimit: 6,
      promptProfile: 'standard',
      performanceProfile: 'standard_chat',
      guidance: '这一轮可更完整：私聊先回答，再补一层情绪或细节，必要时轻追问。',
    },
    replyPlan: {
      type: 'empathic_followup',
      depth: 'medium',
      questionNeeded: true,
      interpretation: {
        subIntent: '亲近陪伴',
        tone: '温柔贴近',
        expectsDepth: 'medium',
        needsEmpathy: true,
      },
    },
  });

  assert.match(prompt, /默认使用中文/);
  assert.match(prompt, /特殊对象/);
  assert.match(prompt, /Scathach/);
  assert.match(prompt, /记忆/);
  assert.match(prompt, /特殊羁绊=/);
  assert.match(prompt, /现实威胁|伤害/);
  assert.match(prompt, /接话规划/);
  assert.match(prompt, /当前理解/);
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
      guidance: '这是轻量群聊回复：先接话，再补一句态度，控制在 2 到 3 句。',
    },
    replyPlan: {
      type: 'direct',
      depth: 'short',
      questionNeeded: false,
    },
  });

  assert.match(prompt, /轻量群聊回复/);
  assert.doesNotMatch(prompt, /知识\n/);
  assert.doesNotMatch(prompt, /近期群事件/);
});

test('buildReplyContext includes structured voice reply instructions when voice is eligible', () => {
  const prompt = buildReplyContext({
    event: { platform: 'qq', chatType: 'private', userName: 'Alice', mentionsBot: false },
    route: { category: 'private_chat', allowFollowUp: true },
    relation: { affection: 72, memorySummary: 'private user' },
    userState: { currentEmotion: 'AFFECTIONATE' },
    userProfile: {
      profileSummary: 'likes natural replies',
      favoriteTopics: ['daily'],
      dislikes: [],
    },
    conversationState: { rollingSummary: '', messages: [] },
    groupState: null,
    recentEvents: [],
    messageAnalysis: { intent: 'chat', sentiment: 'positive', relevance: 0.8, ruleSignals: ['private-chat'] },
    emotionResult: { intensity: 0.8, promptStyle: 'warm', toneHints: ['soft'] },
    knowledge: { documents: [] },
    isAdmin: false,
    specialUser: null,
    replyLengthProfile: {
      tier: 'balanced',
      maxTokens: 240,
      historyLimit: 3,
      promptProfile: 'standard',
      performanceProfile: 'standard_chat',
      guidance: 'natural reply',
    },
    replyPlan: {
      type: 'direct',
      depth: 'short',
      questionNeeded: false,
    },
    voiceReplyPolicy: {
      allowed: true,
      suggestedByEmotion: true,
    },
  });

  assert.match(prompt, /JSON/i);
  assert.match(prompt, /sendVoice/);
  assert.match(prompt, /voiceText/);
});
