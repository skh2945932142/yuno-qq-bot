import test from 'node:test';
import assert from 'node:assert/strict';
import { processIncomingMessage } from './src/message-workflow.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    userName: 'Alice',
    rawText: '你会什么',
    text: '你会什么',
    attachments: [],
    mentionsBot: false,
    timestamp: Date.now(),
    source: { adapter: 'test' },
    ...overrides,
  };
}

test('processIncomingMessage runs the unified workflow and persists memory with mocks', async () => {
  const sentReplies = [];
  const persistedMessages = [];
  const knowledgeQueries = [];

  const reply = await processIncomingMessage(createEvent({
    rawText: '你的设定是什么',
    text: '你的设定是什么',
  }), {
    relation: { _id: 'r1', affection: 40, activeScore: 20, preferences: [], favoriteTopics: [], userId: '10001', platform: 'qq', chatType: 'private', chatId: '10001' },
    userState: { _id: 'u1', currentEmotion: 'CALM', intensity: 0.4, triggerReason: 'baseline', userId: '10001', platform: 'qq', chatType: 'private', chatId: '10001' },
    userProfile: { _id: 'p1', profileSummary: '', favoriteTopics: [], dislikes: [], preferredName: '', tonePreference: '' },
    conversationState: { rollingSummary: '之前聊过你喜欢看番。', messages: [{ role: 'user', content: '嗨' }, { role: 'assistant', content: '在。' }] },
    groupState: null,
    recentEvents: [],
    isAdmin: false,
    isAdvanced: false,
    event: createEvent({
      rawText: '你的设定是什么',
      text: '你的设定是什么',
    }),
    analysis: {
      shouldRespond: true,
      confidence: 0.9,
      intent: 'query',
      sentiment: 'neutral',
      relevance: 0.9,
      reason: 'private-default-reply',
      topics: ['设定'],
      ruleSignals: ['private-chat'],
      replyStyle: 'calm',
    },
  }, {
    deps: {
      sendReply: async (_target, text) => {
        sentReplies.push(text);
      },
      sendVoice: async () => false,
      retrieveKnowledge: async (query) => {
        knowledgeQueries.push(query);
        return {
          enabled: true,
          documents: [{ text: '由乃会保持自然、克制、会接话。', metadata: { title: '人格', source: 'knowledge/persona/core.md' } }],
        };
      },
      chat: async (_messages, _systemPrompt, userTurn) => `回答:${userTurn}`,
      appendConversationMessages: async (_session, messages) => {
        persistedMessages.push(...messages);
        return { rollingSummary: 'summary', messages };
      },
      updateRelationProfile: async () => null,
      updateUserState: async () => null,
      updateUserProfileMemory: async () => null,
      shouldSendVoiceForEmotion: () => false,
    },
  });

  assert.equal(reply, '回答:你的设定是什么');
  assert.equal(sentReplies[0], '回答:你的设定是什么');
  assert.equal(knowledgeQueries[0], '你的设定是什么');
  assert.equal(persistedMessages.length, 2);
  assert.equal(persistedMessages[0].role, 'user');
  assert.equal(persistedMessages[1].role, 'assistant');
});
