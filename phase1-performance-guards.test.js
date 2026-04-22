import test from 'node:test';
import assert from 'node:assert/strict';
import { processIncomingMessage } from './src/message-workflow.js';
import { retrieveKnowledge } from './src/knowledge-base.js';
import { cleanupGroupEventsRetention } from './src/state/group-state-runtime.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    userName: 'Alice',
    rawText: '我们聊聊今天吧',
    text: '我们聊聊今天吧',
    attachments: [],
    mentionsBot: false,
    timestamp: Date.now(),
    source: { adapter: 'test', postType: 'message' },
    ...overrides,
  };
}

function createPrecomputed(event = createEvent()) {
  return {
    relation: { _id: 'r1', affection: 45, activeScore: 20, preferences: [], favoriteTopics: [], userId: event.userId, platform: event.platform, chatType: event.chatType, chatId: event.chatId },
    userState: { _id: 'u1', currentEmotion: 'CALM', intensity: 0.3, triggerReason: 'baseline', userId: event.userId, platform: event.platform, chatType: event.chatType, chatId: event.chatId },
    userProfile: { _id: 'p1', profileSummary: '', favoriteTopics: [], dislikes: [], preferredName: '', tonePreference: '' },
    conversationState: { rollingSummary: '', messages: [] },
    groupState: null,
    recentEvents: [],
    isAdmin: false,
    isAdvanced: false,
    event,
    analysis: {
      shouldRespond: true,
      confidence: 0.9,
      intent: 'social',
      sentiment: 'neutral',
      relevance: 0.6,
      reason: 'private-default-reply',
      topics: [],
      ruleSignals: ['private-chat'],
      replyStyle: 'calm',
    },
  };
}

test('processIncomingMessage uses short fallback when reply budget is exceeded', async () => {
  const sentReplies = [];
  const event = createEvent();
  const precomputed = createPrecomputed(event);

  const reply = await processIncomingMessage(event, precomputed, {
    replyTimeBudgetMs: 20,
    deps: {
      sendReply: async (_target, text) => {
        sentReplies.push(text);
      },
      sendVoice: async () => false,
      retrieveKnowledge: async () => ({ enabled: false, documents: [], reason: 'disabled' }),
      chat: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return 'this should not be used';
      },
      appendConversationMessages: async () => null,
      updateRelationProfile: async () => null,
      updateUserState: async () => null,
      updateUserProfileMemory: async () => null,
      shouldSendVoiceForEmotion: () => false,
    },
  });

  assert.match(reply, /我先接住|先接一句/);
  assert.equal(sentReplies.length, 1);
});

test('processIncomingMessage retries once with fallback model on model unavailable', async () => {
  const sentReplies = [];
  const chatCalls = [];
  const event = createEvent();
  const precomputed = createPrecomputed(event);

  const reply = await processIncomingMessage(event, precomputed, {
    modelFallbackChatModel: 'mock-fast-model',
    replyTimeBudgetMs: 1000,
    deps: {
      sendReply: async (_target, text) => {
        sentReplies.push(text);
      },
      sendVoice: async () => false,
      retrieveKnowledge: async () => ({ enabled: false, documents: [], reason: 'disabled' }),
      chat: async (_messages, _systemPrompt, _userTurn, options = {}) => {
        chatCalls.push(options.model || 'primary');
        if (!options.model) {
          const error = new Error('timeout');
          error.code = 'MODEL_TIMEOUT';
          throw error;
        }
        return 'fallback model reply';
      },
      appendConversationMessages: async () => null,
      updateRelationProfile: async () => null,
      updateUserState: async () => null,
      updateUserProfileMemory: async () => null,
      shouldSendVoiceForEmotion: () => false,
    },
  });

  assert.equal(chatCalls.length, 2);
  assert.equal(chatCalls[1], 'mock-fast-model');
  assert.match(reply, /fallback model reply/);
  assert.equal(sentReplies.length, 1);
});

test('retrieveKnowledge uses short-lived in-memory query cache', async () => {
  let embeddingCalls = 0;
  let searchCalls = 0;

  const options = {
    cacheTtlMs: 5_000,
    getQdrantStatus: () => ({ enabled: true, collection: 'test' }),
    createEmbeddings: async () => {
      embeddingCalls += 1;
      return [{ embedding: [0.1, 0.2, 0.3] }];
    },
    searchKnowledge: async () => {
      searchCalls += 1;
      return [{
        id: 'doc-1',
        score: 0.8,
        payload: {
          text: 'cached text',
          category: 'faq',
          title: 'cached',
          tags: ['cache'],
          priority: 1,
          source: 'knowledge/faq/common.md',
          version: 'v1',
        },
      }];
    },
  };

  const first = await retrieveKnowledge('缓存命中测试', options);
  const second = await retrieveKnowledge('缓存命中测试', options);

  assert.equal(first.documents.length, 1);
  assert.equal(second.documents.length, 1);
  assert.equal(embeddingCalls, 1);
  assert.equal(searchCalls, 1);
});

test('cleanupGroupEventsRetention prunes by retention window in background mode', async () => {
  const deletedQueries = [];
  const model = {
    distinct: async () => ['g1', 'g2'],
    findOne: ({ groupId }) => ({
      sort: () => ({
        skip: () => ({
          select: async () => (groupId === 'g1' ? { createdAt: new Date('2026-04-22T00:00:00Z') } : null),
        }),
      }),
    }),
    deleteMany: async (query) => {
      deletedQueries.push(query);
      return { deletedCount: 3 };
    },
  };

  const result = await cleanupGroupEventsRetention({
    retentionCount: 100,
  }, {
    GroupEvent: model,
  });

  assert.equal(result.groupCount, 2);
  assert.equal(result.deletedCount, 3);
  assert.equal(deletedQueries.length, 1);
  assert.equal(deletedQueries[0].groupId, 'g1');
});
