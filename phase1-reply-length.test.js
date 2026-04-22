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
    rawText: '今天有点累，想和你说会儿话。',
    text: '今天有点累，想和你说会儿话。',
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
  assert.equal(groupProfile.maxTokens, 140);
  assert.equal(groupProfile.promptProfile, 'fast');
  assert.equal(groupProfile.historyLimit, 1);
  assert.equal(groupProfile.performanceProfile, 'fast_chat');
  assert.equal(knowledgeProfile.tier, 'expanded');
  assert.equal(knowledgeProfile.maxTokens, config.knowledgeReplyMaxTokens);
  assert.equal(knowledgeProfile.promptProfile, 'standard');
  assert.equal(knowledgeProfile.historyLimit, 4);
  assert.equal(knowledgeProfile.performanceProfile, 'knowledge_chat');
});

test('buildReplyContext includes reply length guidance and prompt profile', () => {
  const prompt = buildReplyContext({
    event: createEvent(),
    route: { category: 'private_chat', allowFollowUp: true },
    relation: { affection: 72, memorySummary: '熟悉的聊天对象。' },
    userState: { currentEmotion: 'AFFECTIONATE' },
    userProfile: {
      profileSummary: '偏好更柔和的语气。',
      preferredName: '阿离',
      favoriteTopics: ['日常'],
      dislikes: [],
    },
    conversationState: { rollingSummary: '刚刚聊到今天有点累。', messages: [] },
    groupState: null,
    recentEvents: [],
    messageAnalysis: { intent: 'social', sentiment: 'positive', relevance: 0.82, ruleSignals: ['private-chat'] },
    emotionResult: { intensity: 0.75, promptStyle: 'warm and complete', toneHints: ['comfort'] },
    knowledge: { documents: [] },
    isAdmin: false,
    specialUser: null,
    replyPlan: {
      type: 'direct_followup',
      depth: 'medium',
      questionNeeded: true,
    },
    replyLengthProfile: {
      tier: 'expanded',
      maxTokens: 520,
      historyLimit: 6,
      promptProfile: 'standard',
      performanceProfile: 'standard_chat',
      guidance: '这一轮可更完整：私聊先回答，再补一层情绪或细节，必要时轻追问。',
    },
  });

  assert.match(prompt, /场景/);
  assert.match(prompt, /会话=私聊 路由=private_chat 模式=standard_chat/);
  assert.match(prompt, /长度要求=这一轮可更完整/);
  assert.match(prompt, /默认使用中文/);
  assert.match(prompt, /接话规划/);
});

test('resolveReplyLengthProfile uses fast_chat for ordinary private openings', () => {
  const profile = resolveReplyLengthProfile({
    event: createEvent({
      rawText: '今天终于忙完了，想和你说会儿话。',
      text: '今天终于忙完了，想和你说会儿话。',
    }),
    route: { category: 'private_chat' },
    analysis: { intent: 'social', sentiment: 'positive', relevance: 0.55 },
    emotionResult: { emotion: 'CALM' },
    conversationState: { rollingSummary: '', messages: [] },
  });

  assert.equal(profile.performanceProfile, 'fast_chat');
  assert.equal(profile.promptProfile, 'fast');
  assert.equal(profile.historyLimit, 2);
  assert.equal(profile.maxTokens, 220);
});

test('processIncomingMessage passes route-specific generation profile to chat', async () => {
  const captured = [];

  await processIncomingMessage(createEvent({
    chatType: 'group',
    chatId: '20001',
    rawText: '由乃，今晚你怎么看？',
    text: '由乃，今晚你怎么看？',
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
      rawText: '由乃，今晚你怎么看？',
      text: '由乃，今晚你怎么看？',
      mentionsBot: true,
    }),
    analysis: {
      shouldRespond: true,
      confidence: 0.92,
      intent: 'query',
      sentiment: 'neutral',
      relevance: 0.9,
      reason: 'basic-direct-mention-pass',
      topics: ['plan'],
      ruleSignals: ['direct-mention'],
      replyStyle: 'calm',
    },
  }, {
    deps: {
      sendReply: async () => null,
      sendVoice: async () => false,
      retrieveKnowledge: async () => ({ enabled: false, documents: [], reason: 'disabled' }),
      chat: async (_messages, _systemPrompt, _userTurn, options) => {
        captured.push({
          maxTokens: options.maxTokens,
          historyLimit: options.historyLimit,
          temperature: options.temperature,
        });
        return '先把重点说出来，再留一点余地。';
      },
      appendConversationMessages: async () => null,
      updateRelationProfile: async () => null,
      updateUserState: async () => null,
      updateUserProfileMemory: async () => null,
      shouldSendVoiceForEmotion: () => false,
    },
  });

  assert.equal(captured[0].maxTokens, 140);
  assert.equal(captured[0].historyLimit, 4);
  assert.equal(captured[0].temperature, 0.46);
});
