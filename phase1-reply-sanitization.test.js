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

function createContext(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function createDeps(sendReply, chat) {
  return {
    sendReply,
    sendVoice: async () => false,
    retrieveKnowledge: async () => ({
      enabled: false,
      documents: [],
      reason: 'disabled',
    }),
    chat,
    appendConversationMessages: async () => null,
    updateRelationProfile: async () => null,
    updateUserState: async () => null,
    updateUserProfileMemory: async () => null,
    shouldSendVoiceForEmotion: () => false,
  };
}

test('stripHiddenReasoning removes think tags and keeps visible reply text', () => {
  const result = stripHiddenReasoning('<think>internal plan</think>\n我也喜欢你。');
  assert.equal(result, '我也喜欢你。');
});

test('processIncomingMessage strips hidden reasoning before sending the reply', async () => {
  const sentReplies = [];

  const reply = await processIncomingMessage(createEvent(), createContext(), {
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async () => '<think>用户在表白，先分析语气。</think>\n我也喜欢你。'
    ),
  });

  assert.equal(reply, '我也喜欢你。');
  assert.equal(sentReplies[0], '我也喜欢你。');
  assert.equal(sentReplies[0].includes('<think>'), false);
});

test('processIncomingMessage falls back to a Chinese retry line when only hidden reasoning is returned', async () => {
  const sentReplies = [];

  const reply = await processIncomingMessage(
    createEvent({
      rawText: '你还在吗？',
      text: '你还在吗？',
    }),
    createContext({
      event: createEvent({
        rawText: '你还在吗？',
        text: '你还在吗？',
      }),
      analysis: {
        shouldRespond: true,
        confidence: 0.95,
        intent: 'chat',
        sentiment: 'neutral',
        relevance: 0.82,
        reason: 'private-default-reply',
        topics: ['在吗'],
        ruleSignals: ['private-chat'],
        replyStyle: 'calm',
      },
    }),
    {
      deps: createDeps(
        async (_target, text) => {
          sentReplies.push(text);
        },
        async () => '<think>这里只有隐藏思考</think>'
      ),
    }
  );

  assert.equal(reply, '刚才那句被我吞掉了，你再说一遍。');
  assert.equal(sentReplies[0], '刚才那句被我吞掉了，你再说一遍。');
});

test('processIncomingMessage flattens line-by-line chat replies before sending', async () => {
  const sentReplies = [];

  const reply = await processIncomingMessage(createEvent(), createContext(), {
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async () => '嗯...？！又饿了？！\n你之前不是说在吃晚饭吗...\n怎么还在饿...\n快去吃东西...'
    ),
  });

  assert.equal(reply, '嗯...？！又饿了？！你之前不是说在吃晚饭吗...怎么还在饿...快去吃东西...');
  assert.equal(sentReplies[0], '嗯...？！又饿了？！你之前不是说在吃晚饭吗...怎么还在饿...快去吃东西...');
});
