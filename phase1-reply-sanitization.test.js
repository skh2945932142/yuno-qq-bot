import test from 'node:test';
import assert from 'node:assert/strict';
import { processIncomingMessage, stripHiddenReasoning } from './src/message-workflow.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    userName: 'Alice',
    rawText: '由乃我喜欢你',
    text: '由乃我喜欢你',
    attachments: [],
    mentionsBot: false,
    timestamp: Date.now(),
    source: { adapter: 'test' },
    ...overrides,
  };
}

test('stripHiddenReasoning removes think tags and keeps visible reply text', () => {
  const result = stripHiddenReasoning('<think>internal plan</think>\n我也喜欢你。');
  assert.equal(result, '我也喜欢你。');
});

test('processIncomingMessage strips hidden reasoning before sending the reply', async () => {
  const sentReplies = [];

  const reply = await processIncomingMessage(createEvent(), {
    relation: { _id: 'r1', affection: 72, activeScore: 20, preferences: [], favoriteTopics: [], userId: '10001', platform: 'qq', chatType: 'private', chatId: '10001' },
    userState: { _id: 'u1', currentEmotion: 'AFFECTIONATE', intensity: 0.4, triggerReason: 'baseline', userId: '10001', platform: 'qq', chatType: 'private', chatId: '10001' },
    userProfile: { _id: 'p1', profileSummary: '', favoriteTopics: [], dislikes: [], preferredName: '', tonePreference: '' },
    conversationState: { rollingSummary: '', messages: [] },
    groupState: null,
    recentEvents: [],
    isAdmin: false,
    isAdvanced: false,
    event: createEvent(),
    analysis: {
      shouldRespond: true,
      confidence: 0.95,
      intent: 'social',
      sentiment: 'positive',
      relevance: 0.9,
      reason: 'private-default-reply',
      topics: ['喜欢'],
      ruleSignals: ['private-chat'],
      replyStyle: 'calm',
    },
  }, {
    deps: {
      sendReply: async (_target, text) => {
        sentReplies.push(text);
      },
      sendVoice: async () => false,
      retrieveKnowledge: async () => ({
        enabled: false,
        documents: [],
        reason: 'disabled',
      }),
      chat: async () => '<think>用户在表白，需要先分析语气。</think>\n我也喜欢你。',
      appendConversationMessages: async () => null,
      updateRelationProfile: async () => null,
      updateUserState: async () => null,
      updateUserProfileMemory: async () => null,
      shouldSendVoiceForEmotion: () => false,
    },
  });

  assert.equal(reply, '我也喜欢你。');
  assert.equal(sentReplies[0], '我也喜欢你。');
  assert.equal(sentReplies[0].includes('<think>'), false);
});
