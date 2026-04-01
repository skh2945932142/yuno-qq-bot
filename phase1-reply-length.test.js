import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from './src/config.js';
import { buildReplyContext } from './src/prompt-builder.js';
import { resolveReplyLengthProfile } from './src/reply-length.js';
import { processIncomingMessage } from './src/message-workflow.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    userName: 'Alice',
    rawText: '今天有点累',
    text: '今天有点累',
    attachments: [],
    mentionsBot: false,
    timestamp: Date.now(),
    source: { adapter: 'test', postType: 'message' },
    ...overrides,
  };
}

test('resolveReplyLengthProfile expands knowledge answers more than normal group chat', () => {
  const groupProfile = resolveReplyLengthProfile({
    event: createEvent({ chatType: 'group', chatId: '20001' }),
    route: { category: 'group_chat' },
    analysis: { intent: 'chat', sentiment: 'neutral', relevance: 0.55 },
    emotionResult: { emotion: 'CALM' },
    conversationState: { messages: [] },
  });
  const knowledgeProfile = resolveReplyLengthProfile({
    event: createEvent({ chatType: 'group', chatId: '20001' }),
    route: { category: 'knowledge_qa' },
    analysis: { intent: 'query', sentiment: 'neutral', relevance: 0.95 },
    emotionResult: { emotion: 'CALM' },
    conversationState: { messages: [] },
  });

  assert.equal(groupProfile.tier, 'balanced');
  assert.equal(groupProfile.maxTokens, config.groupChatMaxTokens);
  assert.equal(knowledgeProfile.tier, 'expanded');
  assert.equal(knowledgeProfile.maxTokens, config.knowledgeReplyMaxTokens);
});

test('buildReplyContext includes reply length guidance', () => {
  const prompt = buildReplyContext({
    event: createEvent(),
    route: { category: 'private_chat', allowFollowUp: true },
    relation: { affection: 72, memorySummary: '熟悉的聊天对象' },
    userState: { currentEmotion: 'AFFECTIONATE' },
    userProfile: {
      profileSummary: '喜欢温柔一点的语气',
      preferredName: '阿离',
      favoriteTopics: ['日常'],
      dislikes: [],
    },
    conversationState: { rollingSummary: '刚聊过今天的状态', messages: [] },
    groupState: null,
    recentEvents: [],
    messageAnalysis: { intent: 'social', sentiment: 'positive', relevance: 0.82, ruleSignals: ['private-chat'] },
    emotionResult: { intensity: 0.75, promptStyle: '温柔完整', toneHints: ['偏爱', '安抚'] },
    knowledge: { documents: [] },
    isAdmin: false,
    specialUser: null,
    replyLengthProfile: {
      tier: 'expanded',
      maxTokens: 520,
      guidance: 'Length mode: expanded. In private chat, give a fuller and more emotionally complete reply.',
    },
  });

  assert.match(prompt, /Reply Length/);
  assert.match(prompt, /tier=expanded/);
  assert.match(prompt, /maxTokens=520/);
});

test('processIncomingMessage passes route-specific maxTokens to chat generation', async () => {
  const captured = [];

  await processIncomingMessage(createEvent({
    chatType: 'group',
    chatId: '20001',
    rawText: '由乃，你怎么看今天的安排？',
    text: '由乃，你怎么看今天的安排？',
    mentionsBot: true,
  }), {
    relation: { _id: 'r1', affection: 55, activeScore: 20, preferences: [], favoriteTopics: [], userId: '10001', platform: 'qq', chatType: 'group', chatId: '20001' },
    userState: { _id: 'u1', currentEmotion: 'CALM', intensity: 0.4, triggerReason: 'baseline', userId: '10001', platform: 'qq', chatType: 'group', chatId: '20001' },
    userProfile: { _id: 'p1', profileSummary: '', favoriteTopics: [], dislikes: [], preferredName: '', tonePreference: '' },
    conversationState: { rollingSummary: '', messages: [] },
    groupState: null,
    recentEvents: [],
    isAdmin: false,
    isAdvanced: false,
    event: createEvent({
      chatType: 'group',
      chatId: '20001',
      rawText: '由乃，你怎么看今天的安排？',
      text: '由乃，你怎么看今天的安排？',
      mentionsBot: true,
    }),
    analysis: {
      shouldRespond: true,
      confidence: 0.92,
      intent: 'query',
      sentiment: 'neutral',
      relevance: 0.9,
      reason: 'basic-direct-mention-pass',
      topics: ['安排'],
      ruleSignals: ['direct-mention'],
      replyStyle: 'calm',
    },
  }, {
    deps: {
      sendReply: async () => null,
      sendVoice: async () => false,
      retrieveKnowledge: async () => ({ enabled: false, documents: [], reason: 'disabled' }),
      chat: async (_messages, _systemPrompt, _userTurn, options) => {
        captured.push(options.maxTokens);
        return '我觉得今天可以先把最重要的事排前面，再留一点余量。';
      },
      appendConversationMessages: async () => null,
      updateRelationProfile: async () => null,
      updateUserState: async () => null,
      updateUserProfileMemory: async () => null,
      shouldSendVoiceForEmotion: () => false,
    },
  });

  assert.equal(captured[0], 420);
});
