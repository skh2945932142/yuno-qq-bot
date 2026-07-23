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

function createDeps(sendReply, chat, overrides = {}) {
  return {
    sendReply,
    sendVoice: async () => false,
    tts: async () => Buffer.from('voice'),
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
    ...overrides,
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

test('processIncomingMessage parses structured JSON after hidden reasoning from a fallback model', async () => {
  const sentReplies = [];

  const reply = await processIncomingMessage(createEvent(), createContext(), {
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async () => '<think>先判断亲近陪伴场景。</think>\n{"text":"行，这会儿我先听你的。","sendVoice":false,"voiceText":""}'
    ),
  });

  assert.equal(reply, '行，这会儿我先听你的。');
  assert.equal(sentReplies[0], '行，这会儿我先听你的。');
  assert.doesNotMatch(sentReplies[0], /think|sendVoice|voiceText/);
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

test('processIncomingMessage uses a Chinese non-retry fallback when only hidden reasoning is returned', async () => {
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

  assert.match(reply, /没接完整/);
  assert.doesNotMatch(reply, /再说一遍|Here is|JSON/i);
  assert.equal(sentReplies[0], reply);
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

test('group chat keeps normal replies for burst triggers from the same user', async () => {
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

  assert.equal(third, '我在。');
  assert.equal(sentReplies[2], '我在。');
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

test('distinct fallback provider is attempted for the same model and cannot suppress canned fallback', async () => {
  const sentReplies = [];
  const modelCalls = [];

  const reply = await processIncomingMessage(createEvent(), createContext(), {
    replyLlmChatModel: 'shared-model',
    replyLlmBaseUrl: 'https://primary.example/v1',
    replyLlmApiKey: 'primary-key',
    replyLlmFallbackChatModel: 'shared-model',
    replyLlmFallbackBaseUrl: 'https://fallback.example/v1',
    replyLlmFallbackApiKey: 'fallback-key',
    replyTimeBudgetMs: 2000,
    replyPrimaryTimeoutMs: 500,
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async (_messages, _systemPrompt, _userTurn, options = {}) => {
        modelCalls.push(options.providerKind);
        if (options.providerKind === 'reply') {
          const error = new Error('primary timed out');
          error.code = 'MODEL_TIMEOUT';
          throw error;
        }

        const fallbackError = new Error('fallback credentials rejected');
        fallbackError.status = 400;
        throw fallbackError;
      }
    ),
  });

  assert.deepEqual(modelCalls, ['reply', 'reply-fallback']);
  assert.match(reply, /刚才卡了一下/);
  assert.equal(sentReplies.length, 1);
  assert.equal(sentReplies[0], reply);
});

test('processIncomingMessage uses the configured fallback model after a 500', async () => {
  const sentReplies = [];
  const modelCalls = [];

  const reply = await processIncomingMessage(createEvent(), createContext(), {
    replyLlmFallbackChatModel: 'gemini-3.1-flash-lite',
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async (_messages, _systemPrompt, _userTurn, options = {}) => {
        modelCalls.push(`${options.providerKind || 'reply'}:${options.model || 'primary'}`);
        if (!options.model) {
          const error = new Error('500 status code (no body)');
          error.status = 500;
          throw error;
        }
        return '{"text":"我接着呢，刚才那句没有丢。","sendVoice":false,"voiceText":""}';
      }
    ),
  });

  assert.deepEqual(modelCalls, ['reply:primary', 'reply-fallback:gemini-3.1-flash-lite']);
  assert.equal(reply, '我接着呢，刚才那句没有丢。');
  assert.equal(sentReplies[0], reply);
});

test('429 forwards the same reply input to Gemini 3.1 Flash Lite without an intermediate message', async () => {
  const sentReplies = [];
  const modelCalls = [];
  const reply = await processIncomingMessage(createEvent(), createContext(), {
    replyLlmFallbackChatModel: 'gemini-3.1-flash-lite',
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async (messages, systemPrompt, userTurn, options = {}) => {
        modelCalls.push({ messages, systemPrompt, userTurn, options });
        if (options.providerKind !== 'reply-fallback') {
          const error = new Error('429 status code (no body)');
          error.status = 429;
          throw error;
        }
        return '{"text":"限流而已，我没把你刚才的话弄丢。","sendVoice":false,"voiceText":""}';
      }
    ),
  });

  assert.equal(reply, '限流而已，我没把你刚才的话弄丢。');
  assert.deepEqual(
    modelCalls.map(({ options }) => `${options.providerKind}:${options.model || 'primary'}`),
    ['reply:primary', 'reply-fallback:gemini-3.1-flash-lite']
  );
  assert.strictEqual(modelCalls[1].messages, modelCalls[0].messages);
  assert.strictEqual(modelCalls[1].systemPrompt, modelCalls[0].systemPrompt);
  assert.strictEqual(modelCalls[1].userTurn, modelCalls[0].userTurn);
  assert.equal(modelCalls[1].options.promptVersion, modelCalls[0].options.promptVersion);
  assert.equal(modelCalls[1].options.expectStructuredReply, modelCalls[0].options.expectStructuredReply);
  assert.equal(modelCalls[1].options.reasoningEffort, 'minimal');
  assert.ok(modelCalls[1].options.maxTokens >= 384);
  assert.equal(modelCalls[1].options.historyLimit, modelCalls[0].options.historyLimit);
  assert.equal(modelCalls[1].options.temperature, modelCalls[0].options.temperature);
  assert.equal(sentReplies.length, 1);
  assert.doesNotMatch(sentReplies[0], /Yuno大脑过载了呢/);
});

test('primary JSON boilerplate is treated as invalid and regenerated by the fallback model', async () => {
  const modelCalls = [];
  const reply = await processIncomingMessage(createEvent(), createContext(), {
    replyLlmFallbackChatModel: 'gemini-3.1-flash-lite',
    deps: createDeps(
      async () => null,
      async (_messages, _systemPrompt, _userTurn, options = {}) => {
        modelCalls.push(options.providerKind || 'reply');
        if (options.providerKind !== 'reply-fallback') {
          return 'Here is the JSON';
        }
        return '{"text":"我在，刚才那句我看见了。","sendVoice":false,"voiceText":""}';
      }
    ),
  });

  assert.deepEqual(modelCalls, ['reply', 'reply-fallback']);
  assert.equal(reply, '我在，刚才那句我看见了。');
});

test('JSON boilerplate from both reply models is never sent to the user', async () => {
  const sentReplies = [];
  const reply = await processIncomingMessage(createEvent(), createContext(), {
    replyLlmFallbackChatModel: 'gemini-3.1-flash-lite',
    deps: createDeps(
      async (_target, text) => {
        sentReplies.push(text);
      },
      async () => 'Here is the JSON requested',
    ),
  });

  assert.equal(reply, '我在。刚才那句没接完整，你不用重发。');
  assert.deepEqual(sentReplies, [reply]);
  assert.doesNotMatch(reply, /Here is|JSON/i);
});

test('aggressive generated reply is rewritten once by the same provider before sending', async () => {
  const sentReplies = [];
  const modelCalls = [];
  const reply = await processIncomingMessage(createEvent({ rawText: '因为有你呀' }), createContext(), {
    deps: createDeps(
      async (_target, text) => sentReplies.push(text),
      async (_messages, _systemPrompt, _userTurn, options = {}) => {
        modelCalls.push({ operation: options.operation, providerKind: options.providerKind, temperature: options.temperature });
        if (options.operation === 'reply-style-rewrite') {
          return JSON.stringify({ text: '嗯，听你这么说，我有点高兴。只是没打算表现得太明显。', sendVoice: false, voiceText: '' });
        }
        return JSON.stringify({
          text: '这种话倒是说得越来越顺口了。你就这么确定，每次拿这句话当理由都能在我这蒙混过关？',
          sendVoice: false,
          voiceText: '',
        });
      },
    ),
  });

  assert.equal(reply, '嗯，听你这么说，我有点高兴。只是没打算表现得太明显。');
  assert.deepEqual(sentReplies, [reply]);
  assert.deepEqual(modelCalls.map((item) => item.operation), ['reply', 'reply-style-rewrite']);
  assert.equal(modelCalls[1].providerKind, 'reply');
  assert.equal(modelCalls[1].temperature, 0.35);
  assert.doesNotMatch(reply, /蒙混过关|每次拿|你就这么确定/);
});

test('style rewrite failure never sends the original accusatory reply', async () => {
  const sentReplies = [];
  const reply = await processIncomingMessage(createEvent({ rawText: '因为有你呀' }), createContext(), {
    deps: createDeps(
      async (_target, text) => sentReplies.push(text),
      async (_messages, _systemPrompt, _userTurn, options = {}) => {
        if (options.operation === 'reply-style-rewrite') {
          throw new Error('rewrite unavailable');
        }
        return JSON.stringify({
          text: '你每次被讲中就换语气，把责任全扔给我。',
          sendVoice: false,
          voiceText: '',
        });
      },
    ),
  });

  assert.equal(reply, '嗯，听你这么说，我有点高兴。只是没打算表现得太明显。');
  assert.deepEqual(sentReplies, [reply]);
  assert.doesNotMatch(reply, /你每次|责任|扔给我/);
});

test('fallback model style rewrite stays on the fallback provider', async () => {
  const modelCalls = [];
  const reply = await processIncomingMessage(createEvent({ rawText: '因为有你呀' }), createContext(), {
    replyLlmFallbackChatModel: 'gemini-3.1-flash-lite',
    deps: createDeps(
      async () => {},
      async (_messages, _systemPrompt, _userTurn, options = {}) => {
        modelCalls.push({ operation: options.operation, providerKind: options.providerKind });
        if (options.providerKind === 'reply') {
          const error = new Error('429 status code');
          error.status = 429;
          throw error;
        }
        if (options.operation === 'reply-style-rewrite') {
          return JSON.stringify({ text: '嗯，听你这么说，我有点高兴。', sendVoice: false, voiceText: '' });
        }
        return JSON.stringify({ text: '你每次都这样，把我的话当借口。', sendVoice: false, voiceText: '' });
      },
    ),
  });

  assert.equal(reply, '嗯，听你这么说，我有点高兴。');
  assert.deepEqual(modelCalls.map((item) => item.providerKind), ['reply', 'reply-fallback', 'reply-fallback']);
  assert.equal(modelCalls[2].operation, 'reply-style-rewrite');
});

test('voice delivery uses rewritten voice text instead of the aggressive original', async () => {
  const ttsInputs = [];
  const sentVoices = [];
  const reply = await processIncomingMessage(createEvent({
    rawText: '用语音说，因为有你呀',
    text: '用语音说，因为有你呀',
  }), createContext(), {
    deps: createDeps(
      async () => {},
      async (_messages, _systemPrompt, _userTurn, options = {}) => {
        if (options.operation === 'reply-style-rewrite') {
          return JSON.stringify({
            text: '嗯，听你这么说，我有点高兴。',
            sendVoice: false,
            voiceText: '听你这么说，我有点高兴。',
          });
        }
        return JSON.stringify({
          text: '你每次都拿这句话当借口。',
          sendVoice: true,
          voiceText: '你每次都拿这句话当借口。',
        });
      },
      {
        resolveVoiceRuntimeConfig: () => ({
          enableVoice: true,
          voiceName: 'test-voice',
          mode: 'model',
          cooldownMs: 0,
          maxChars: 90,
          onUserRecord: true,
        }),
        tts: async (text) => {
          ttsInputs.push(text);
          return Buffer.from(`audio:${text}`);
        },
        sendVoice: async (_target, audio) => {
          sentVoices.push(audio.toString());
          return true;
        },
      }
    ),
  });

  assert.equal(reply, '嗯，听你这么说，我有点高兴。');
  assert.deepEqual(ttsInputs, ['听你这么说，我有点高兴。']);
  assert.deepEqual(sentVoices, ['audio:听你这么说，我有点高兴。']);
  assert.doesNotMatch(ttsInputs[0], /你每次|借口/);
});

test('personality strategy explicitly forbids unsafe possessive escalation', async () => {
  const { resolvePersonalityStrategy } = await import('./src/personality-strategy.js');
  const strategy = resolvePersonalityStrategy({
    event: createEvent(),
    relation: { affection: 95 },
    userState: { currentEmotion: 'FIXATED' },
    messageAnalysis: { intent: 'social', sentiment: 'positive', ruleSignals: ['special-user'] },
    emotionResult: { emotion: 'FIXATED', intensity: 0.9 },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '亲近陪伴' } },
    specialUser: { label: 'Alice' },
  });

  const boundaries = strategy.forbiddenMoves.join(' ');
  assert.match(boundaries, /现实威胁/);
  assert.match(boundaries, /跟踪/);
  assert.match(boundaries, /控制对方/);
  assert.match(boundaries, /羞辱/);
});

test('robotic acknowledgement is rewritten once before sending', async () => {
  const sentReplies = [];
  const modelCalls = [];
  const reply = await processIncomingMessage(createEvent({ rawText: '因为有你呀' }), createContext(), {
    deps: createDeps(
      async (_target, text) => sentReplies.push(text),
      async (_messages, _systemPrompt, _userTurn, options = {}) => {
        modelCalls.push(options.operation);
        if (options.operation === 'reply-style-rewrite') {
          return JSON.stringify({
            text: '嗯，听你这么说，我其实有点高兴。',
            sendVoice: false,
            voiceText: '',
          });
        }
        return JSON.stringify({
          text: '嗯，这句我收下了。',
          sendVoice: false,
          voiceText: '',
        });
      },
    ),
  });

  assert.equal(reply, '嗯，听你这么说，我其实有点高兴。');
  assert.deepEqual(sentReplies, [reply]);
  assert.deepEqual(modelCalls, ['reply', 'reply-style-rewrite']);
  assert.doesNotMatch(reply, /记下|记住|收下|听到了|知道了|收到/);
});
