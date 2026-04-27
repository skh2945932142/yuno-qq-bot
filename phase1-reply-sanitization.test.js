import test from 'node:test';
import assert from 'node:assert/strict';
import { processIncomingMessage, shapeChatReplyText, stripHiddenReasoning } from './src/message-workflow.js';

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

test('stripHiddenReasoning removes leading reasoning labels and keeps final answer', () => {
  const result = stripHiddenReasoning('分析：先判断用户在群聊里@了我。\n1. 先给简短回应\n2. 再补一句安抚\n我在，你慢慢说。');
  assert.equal(result, '我在，你慢慢说。');
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

test('processIncomingMessage strips leading reasoning prose before sending the reply', async () => {
  const sentReplies = [];

  const reply = await processIncomingMessage(createEvent({
    chatType: 'group',
    chatId: 'group-1',
    userId: 'user-1',
    mentionsBot: true,
    rawText: '@由乃 你在想什么',
    text: '@由乃 你在想什么',
  }), createContext({
    relation: { _id: 'r1', affection: 50, activeScore: 20, preferences: [], favoriteTopics: [], userId: 'user-1', platform: 'qq', chatType: 'group', chatId: 'group-1' },
    userState: { _id: 'u1', currentEmotion: 'CALM', intensity: 0.4, triggerReason: 'baseline', userId: 'user-1', platform: 'qq', chatType: 'group', chatId: 'group-1' },
    event: createEvent({
      chatType: 'group',
      chatId: 'group-1',
      userId: 'user-1',
      mentionsBot: true,
      rawText: '@由乃 你在想什么',
      text: '@由乃 你在想什么',
    }),
    analysis: {
      shouldRespond: true,
      confidence: 0.95,
      intent: 'query',
      sentiment: 'neutral',
      relevance: 0.92,
      reason: 'basic-direct-mention-pass',
      topics: ['chat'],
      ruleSignals: ['direct-mention'],
      replyStyle: 'calm',
    },
  }), {
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async () => 'Reasoning: the user is asking directly.\n- avoid exposing chain of thought\n- answer naturally\n我在想怎么把话说得更清楚一点。'
    ),
  });

  assert.equal(reply, '我在想怎么把话说得更清楚一点。');
  assert.equal(sentReplies[0], '我在想怎么把话说得更清楚一点。');
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

  assert.equal(reply.includes('\n'), false);
  assert.equal(sentReplies[0].includes('\n'), false);
  assert.match(reply, /你之前不是说在吃晚饭吗/);
  assert.match(sentReplies[0], /快去吃东西/);
});

test('shapeChatReplyText compresses repeated short lines and excessive ellipsis', () => {
  const output = shapeChatReplyText('好呀...\n好呀...\n我在呢......\n我在呢......', {
    emojiBudget: 0,
    emojiStyle: 'none',
  });

  assert.equal(output.includes('\n'), false);
  assert.equal((output.match(/好呀/g) || []).length, 1);
  assert.equal((output.match(/我在呢/g) || []).length, 1);
  assert.match(output, /…/);
});

test('group chat uses lightweight throttle hint for burst triggers from same user', async () => {
  const sentReplies = [];
  const event = createEvent({
    chatType: 'group',
    chatId: 'group-1',
    userId: 'user-1',
    mentionsBot: true,
    rawText: '@由乃 在吗',
    text: '@由乃 在吗',
  });
  const context = createContext({
    relation: { _id: 'r1', affection: 40, activeScore: 10, preferences: [], favoriteTopics: [], userId: 'user-1', platform: 'qq', chatType: 'group', chatId: 'group-1' },
    userState: { _id: 'u1', currentEmotion: 'CALM', intensity: 0.2, triggerReason: 'baseline', userId: 'user-1', platform: 'qq', chatType: 'group', chatId: 'group-1' },
    event,
    analysis: {
      shouldRespond: true,
      confidence: 0.91,
      intent: 'chat',
      sentiment: 'neutral',
      relevance: 0.75,
      reason: 'basic-direct-mention-pass',
      topics: ['chat'],
      ruleSignals: ['direct-mention'],
      replyStyle: 'calm',
    },
  });

  const deps = createDeps(
    async (_target, text) => {
      sentReplies.push(text);
    },
    async () => '我在。'
  );

  await processIncomingMessage(event, context, { deps });
  await processIncomingMessage(event, context, { deps });
  const third = await processIncomingMessage(event, context, { deps });

  assert.equal(third, '我在听，慢一点说，我一条条接住。');
  assert.equal(sentReplies[2], '我在听，慢一点说，我一条条接住。');
});

test('processIncomingMessage degrades gracefully when model times out', async () => {
  const sentReplies = [];

  const timeoutError = new Error('Model reply timed out');
  timeoutError.code = 'MODEL_TIMEOUT';

  const reply = await processIncomingMessage(createEvent({
    chatType: 'group',
    chatId: 'group-timeout',
    userId: 'timeout-user',
    mentionsBot: true,
    rawText: '@由乃 你在吗',
    text: '@由乃 你在吗',
  }), createContext({
    relation: { _id: 'r1', affection: 55, activeScore: 10, preferences: [], favoriteTopics: [], userId: 'timeout-user', platform: 'qq', chatType: 'group', chatId: 'group-timeout' },
    userState: { _id: 'u1', currentEmotion: 'CALM', intensity: 0.2, triggerReason: 'baseline', userId: 'timeout-user', platform: 'qq', chatType: 'group', chatId: 'group-timeout' },
    event: createEvent({
      chatType: 'group',
      chatId: 'group-timeout',
      userId: 'timeout-user',
      mentionsBot: true,
      rawText: '@由乃 你在吗',
      text: '@由乃 你在吗',
    }),
    analysis: {
      shouldRespond: true,
      confidence: 0.9,
      intent: 'chat',
      sentiment: 'neutral',
      relevance: 0.8,
      reason: 'basic-direct-mention-pass',
      topics: ['chat'],
      ruleSignals: ['direct-mention'],
      replyStyle: 'calm',
    },
  }), {
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async () => {
        throw timeoutError;
      }
    ),
  });

  assert.match(reply, /刚卡了一下|有点抖动/);
  assert.equal(sentReplies.length, 1);
});
