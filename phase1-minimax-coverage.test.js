import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMessage,
  buildChatCompletionPayload,
  buildChatSystemInstructions,
  buildModelCircuitKey,
  buildOpenAiClientConfig,
  buildStructuredReplyResponseFormat,
  chat,
  classifyReplyTrigger,
  createEmbeddings,
  extractTtsAudioBuffer,
  isMimoVoiceDesignModel,
  resolveTtsVoice,
  resolveTtsVoiceDesign,
  tts,
} from './src/minimax.js';

function createChatClient(content, overrides = {}) {
  const calls = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (payload) => {
            calls.push(payload);
            if (overrides.error) throw overrides.error;
            return {
              choices: [{ message: { content } }],
              usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
            };
          },
        },
      },
    },
  };
}

test('minimax builds provider-specific client and payload configuration', () => {
  const source = {
    llmApiKey: 'chat-key', llmBaseUrl: 'http://chat',
    replyLlmApiKey: 'reply-key', replyLlmBaseUrl: 'http://reply',
    replyLlmFallbackApiKey: 'fallback-key', replyLlmFallbackBaseUrl: 'http://fallback',
    embeddingApiKey: 'embedding-key', embeddingBaseUrl: 'http://embedding', requestTimeoutMs: 123,
  };
  assert.deepEqual(buildOpenAiClientConfig('chat', source), { apiKey: 'chat-key', baseURL: 'http://chat', timeout: 123 });
  assert.deepEqual(buildOpenAiClientConfig('reply', source), { apiKey: 'reply-key', baseURL: 'http://reply', timeout: 123 });
  assert.deepEqual(buildOpenAiClientConfig('reply-fallback', source), { apiKey: 'fallback-key', baseURL: 'http://fallback', timeout: 123 });
  assert.deepEqual(buildOpenAiClientConfig('embedding', source), { apiKey: 'embedding-key', baseURL: 'http://embedding', timeout: 123 });
  assert.equal(buildModelCircuitKey('', ''), 'chat:default');

  const format = buildStructuredReplyResponseFormat();
  assert.equal(format.type, 'json_schema');
  assert.deepEqual(format.json_schema.schema.required, ['text', 'sendVoice', 'voiceText']);

  const payload = buildChatCompletionPayload([{ role: 'user', content: 'hi' }], {
    providerKind: 'reply',
    model: 'gemini-3.5-flash',
    temperature: 0.2,
    maxTokens: 99,
    reasoningEffort: 'low',
    responseFormat: { type: 'json_object' },
    stop: ['END'],
  });
  assert.equal(payload.model, 'gemini-3.5-flash');
  assert.equal(payload.reasoning_effort, 'low');
  assert.deepEqual(payload.stop, ['END']);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
});

test('chat builds bounded conversations and records model usage', async () => {
  const fake = createChatClient(' final answer ');
  const traceContext = { traceId: 'trace-1' };
  const result = await chat([
    { role: 'user', content: 'old' },
    { role: 'assistant', content: 'recent' },
  ], 'system context', 'new question', {
    client: fake.client,
    model: 'test-chat-model',
    historyLimit: 1,
    traceContext,
    promptVersion: 'test/v1',
  });

  assert.equal(result, 'final answer');
  assert.equal(fake.calls[0].messages.length, 3);
  assert.equal(fake.calls[0].messages[1].content, 'recent');
  assert.equal(fake.calls[0].messages[2].content, 'new question');
  assert.equal(traceContext.lastModelUsage.totalTokens, 5);
  assert.equal(traceContext.modelUsages.length, 1);

  const fallbackPrompt = createChatClient('');
  assert.equal(await chat([], 'system', null, {
    client: fallbackPrompt.client,
    model: 'test-chat-model-2',
    historyLimit: 0,
  }), '...');
  assert.match(fallbackPrompt.calls[0].messages[1].content, /自然、简洁/);
  assert.match(buildChatSystemInstructions('context', { expectStructuredReply: true }), /有效 JSON/);
  assert.match(buildChatSystemInstructions('context'), /默认使用中文/);
});

test('chat aborts the underlying OpenAI request when its timeout expires', async () => {
  let requestSignal = null;
  let underlyingRequestAborted = false;
  const client = {
    chat: {
      completions: {
        create: async (_payload, requestOptions = {}) => new Promise((_resolve, reject) => {
          requestSignal = requestOptions.signal;
          if (!requestSignal) {
            reject(new Error('missing abort signal'));
            return;
          }
          requestSignal.addEventListener('abort', () => {
            underlyingRequestAborted = true;
            reject(requestSignal.reason || new Error('aborted'));
          }, { once: true });
        }),
      },
    },
  };

  const startedAt = Date.now();
  await assert.rejects(
    chat([], 'system', 'hello', {
      client,
      model: 'timeout-abort-test-model',
      timeoutMs: 1000,
      operation: 'timeout-abort-test',
    }),
    (error) => error?.code === 'MODEL_TIMEOUT'
  );

  assert.equal(requestSignal?.aborted, true);
  assert.equal(underlyingRequestAborted, true);
  assert.ok(Date.now() - startedAt < 2500);
});

test('createEmbeddings accepts an injected OpenAI-compatible client', async () => {
  const calls = [];
  const data = await createEmbeddings('hello', {
    model: 'embedding-test-model',
    client: {
      embeddings: {
        create: async (payload) => {
          calls.push(payload);
          return { data: [{ embedding: [0.1, 0.2] }] };
        },
      },
    },
  });
  assert.deepEqual(data, [{ embedding: [0.1, 0.2] }]);
  assert.deepEqual(calls[0], { model: 'embedding-test-model', input: ['hello'] });
});

test('analyzeMessage handles empty, structured, malformed, and provider failure paths', async () => {
  const empty = await analyzeMessage('[CQ:at,qq=1]');
  assert.equal(empty.reason, 'fallback-heuristic');
  assert.equal(empty.confidence, 0.2);

  const structured = createChatClient(JSON.stringify({
    intent: 'query', sentiment: 'positive', relevance: 0.8, confidence: 0.9,
    shouldReply: true, reason: 'classified', topics: ['one', 'two'], replyStyle: 'warm',
  }));
  const classified = await analyzeMessage('由乃怎么看？', { affection: 50 }, {
    client: structured.client,
    operation: 'analysis-test',
  });
  assert.equal(classified.reason, 'classified');
  assert.equal(classified.shouldReply, true);
  assert.deepEqual(classified.topics, ['one', 'two']);

  const malformed = createChatClient('not-json');
  assert.equal((await analyzeMessage('帮我一下', {}, { client: malformed.client })).reason, 'fallback-heuristic');

  const failed = createChatClient('', { error: Object.assign(new Error('provider failed'), { code: 'EFAIL' }) });
  assert.equal((await analyzeMessage('普通消息', {}, { client: failed.client })).reason, 'fallback-heuristic');
});

test('classifyReplyTrigger handles empty, structured, malformed, and provider failure paths', async () => {
  assert.deepEqual(await classifyReplyTrigger(''), {
    shouldRespond: false, confidence: 0, category: 'empty', reason: 'empty-message',
  });

  const structured = createChatClient(JSON.stringify({
    shouldRespond: true, confidence: 0.88, category: 'follow_up', reason: 'relevant',
  }));
  const result = await classifyReplyTrigger('怎么做？', { heuristicScore: 0.4 }, { client: structured.client });
  assert.equal(result.reason, 'relevant');
  assert.equal(result.shouldRespond, true);

  const malformed = createChatClient('{');
  assert.equal((await classifyReplyTrigger('帮助', {}, { client: malformed.client })).reason, 'fallback-trigger-classifier');

  const failed = createChatClient('', { error: new Error('provider failed') });
  const fallback = await classifyReplyTrigger('随便聊聊', {}, { client: failed.client });
  assert.equal(fallback.reason, 'fallback-trigger-classifier');
  assert.equal(fallback.shouldRespond, false);
});

test('TTS helpers cover disabled and injected HTTP delivery paths', async () => {
  assert.equal(resolveTtsVoice({ ttsVoice: ' voice ', yunoVoiceUri: 'fallback' }), 'voice');
  assert.equal(resolveTtsVoice({ ttsVoice: '', yunoVoiceUri: ' fallback ' }), 'fallback');
  assert.equal(resolveTtsVoiceDesign({ ttsVoiceDesign: ' design ' }), 'design');
  assert.equal(isMimoVoiceDesignModel('mimo-v2.5-tts-voicedesign'), true);
  assert.equal(isMimoVoiceDesignModel('other'), false);
  assert.equal(extractTtsAudioBuffer({}, 'mimo'), null);
  assert.equal(extractTtsAudioBuffer({}, 'openai_compatible'), null);

  let postCount = 0;
  assert.equal(await tts('hello', {
    runtimeConfig: { enableVoice: false, ttsProvider: 'openai_compatible' },
    httpPost: async () => { postCount += 1; },
  }), null);
  assert.equal(postCount, 0);

  const audio = await tts('hello', {
    runtimeConfig: {
      enableVoice: true,
      ttsProvider: 'openai_compatible',
      ttsVoice: 'voice-1',
      ttsBaseUrl: 'http://tts.invalid',
      ttsApiKey: 'key',
      ttsModel: 'tts-model',
      requestTimeoutMs: 100,
      retryAttempts: 0,
      retryDelayMs: 0,
    },
    httpPost: async () => ({ data: Buffer.from('audio') }),
  });
  assert.equal(audio.toString(), 'audio');
});
