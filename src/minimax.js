import OpenAI from 'openai';
import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import {
  extractTopics,
  inferIntent,
  inferSentiment,
  safeJsonParse,
  stripCqCodes,
} from './utils.js';

export function buildOpenAiClientConfig(kind = 'chat', source = config) {
  const useEmbeddingProvider = kind === 'embedding';
  const useReplyProvider = kind === 'reply';
  return {
    apiKey: useEmbeddingProvider
      ? source.embeddingApiKey
      : useReplyProvider
        ? (source.replyLlmApiKey || source.llmApiKey)
        : source.llmApiKey,
    baseURL: useEmbeddingProvider
      ? source.embeddingBaseUrl
      : useReplyProvider
        ? (source.replyLlmBaseUrl || source.llmBaseUrl)
        : source.llmBaseUrl,
    timeout: source.requestTimeoutMs,
  };
}

const client = new OpenAI(buildOpenAiClientConfig('chat'));
const replyClient = new OpenAI(buildOpenAiClientConfig('reply'));
const embeddingClient = new OpenAI(buildOpenAiClientConfig('embedding'));

function isGeminiProvider(model, baseUrl) {
  return /(^|[/:.-])gemini(?:-|$)/i.test(String(model || ''))
    || /generativelanguage\.googleapis\.com/i.test(String(baseUrl || ''));
}

export function buildStructuredReplyResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'yuno_qq_reply',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          sendVoice: { type: 'boolean' },
          voiceText: { type: 'string' },
        },
        required: ['text', 'sendVoice', 'voiceText'],
        additionalProperties: false,
      },
    },
  };
}

export function buildReplyResponseFormat(options = {}) {
  if (!config.replyLlmStructuredOutput) {
    return options.responseFormat || { type: 'json_object' };
  }

  const model = options.model || config.replyLlmChatModel;
  if (isGeminiProvider(model, config.replyLlmBaseUrl)) {
    return buildStructuredReplyResponseFormat();
  }

  return options.responseFormat || { type: 'json_object' };
}

function resolveChatRuntime(options = {}) {
  const useReplyProvider = options.providerKind === 'reply';
  const source = useReplyProvider ? config.replyLlmChatModel : config.llmChatModel;
  const baseUrl = useReplyProvider ? config.replyLlmBaseUrl : config.llmBaseUrl;
  return {
    client: useReplyProvider ? replyClient : client,
    model: options.model || source,
    baseUrl,
    useReplyProvider,
  };
}

const breakerStates = new Map();

function getBreakerState(providerKind = 'chat') {
  const key = String(providerKind || 'chat');
  if (!breakerStates.has(key)) {
    breakerStates.set(key, { consecutiveFailures: 0, openUntil: 0 });
  }
  return breakerStates.get(key);
}

function createTimeoutError(operation, timeoutMs) {
  const error = new Error(`Model ${operation} timed out after ${timeoutMs}ms`);
  error.code = 'MODEL_TIMEOUT';
  error.operation = operation;
  error.timeoutMs = timeoutMs;
  return error;
}

async function withTimeout(task, timeoutMs, operation) {
  const safeTimeout = Math.max(1000, Number(timeoutMs || config.requestTimeoutMs || 15000));
  let timer = null;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(operation, safeTimeout)), safeTimeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isCircuitOpen(providerKind = 'chat') {
  return Date.now() < getBreakerState(providerKind).openUntil;
}

function raiseCircuitOpenError(operation, providerKind = 'chat') {
  const remainingMs = Math.max(0, getBreakerState(providerKind).openUntil - Date.now());
  const error = new Error(`Model circuit open for ${remainingMs}ms`);
  error.code = 'MODEL_CIRCUIT_OPEN';
  error.operation = operation;
  error.retryAfterMs = remainingMs;
  return error;
}

function markModelSuccess(providerKind = 'chat') {
  const state = getBreakerState(providerKind);
  state.consecutiveFailures = 0;
  state.openUntil = 0;
}

function markModelFailure(error, operation, traceContext, providerKind = 'chat') {
  if (error?.code === 'MODEL_CIRCUIT_OPEN') return;

  const state = getBreakerState(providerKind);
  state.consecutiveFailures += 1;
  const threshold = Math.max(2, Number(config.modelCircuitFailureThreshold || 3));
  if (state.consecutiveFailures < threshold) return;

  const openMs = Math.max(5000, Number(config.modelCircuitOpenMs || 20000));
  state.openUntil = Date.now() + openMs;
  state.consecutiveFailures = 0;

  logger.warn('model', 'Circuit opened after consecutive failures', {
    traceId: traceContext?.traceId,
    operation,
    openMs,
    reason: error?.code || error?.message || 'unknown',
  });
}

function recordModelUsage(traceContext, payload, response, operation) {
  if (!traceContext) return;

  const usage = {
    operation: operation || 'chat',
    model: payload.model,
    promptTokens: response.usage?.prompt_tokens ?? null,
    completionTokens: response.usage?.completion_tokens ?? null,
    totalTokens: response.usage?.total_tokens ?? null,
  };

  traceContext.lastModelUsage = usage;
  if (!Array.isArray(traceContext.modelUsages)) {
    traceContext.modelUsages = [];
  }
  traceContext.modelUsages.push(usage);
}

export function buildChatCompletionPayload(messages, options = {}) {
  const runtime = resolveChatRuntime(options);
  const payload = {
    model: runtime.model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 256,
  };

  if (options.responseFormat) {
    payload.response_format = options.responseFormat;
  }

  if (runtime.useReplyProvider && isGeminiProvider(runtime.model, runtime.baseUrl) && options.reasoningEffort) {
    payload.reasoning_effort = options.reasoningEffort;
  }

  if (options.stop) {
    payload.stop = options.stop;
  }

  return payload;
}

async function createChatCompletion(messages, options = {}) {
  const startedAt = Date.now();
  const operation = options.operation || 'chat';
  const runtime = resolveChatRuntime(options);
  const breakerKey = runtime.useReplyProvider ? 'reply' : 'chat';
  const payload = buildChatCompletionPayload(messages, options);

  if (!payload.model) {
    throw new Error('Missing LLM chat model configuration');
  }

  if (isCircuitOpen(breakerKey)) {
    throw raiseCircuitOpenError(operation, breakerKey);
  }

  try {
    const response = await withRetry(
      () => withTimeout(
        () => runtime.client.chat.completions.create(payload),
        options.timeoutMs || config.requestTimeoutMs,
        operation
      ),
      {
        retries: config.retryAttempts,
        delayMs: config.retryDelayMs,
        category: 'model',
        label: 'chat completion',
        logger,
      }
    );

    markModelSuccess(breakerKey);
    logger.info('model', 'Chat completion finished', {
      traceId: options.traceContext?.traceId,
      operation,
      promptVersion: options.promptVersion,
      model: payload.model,
      elapsedMs: Date.now() - startedAt,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
    });

    recordModelUsage(options.traceContext, payload, response, operation);
    return response;
  } catch (error) {
    markModelFailure(error, operation, options.traceContext, breakerKey);
    throw error;
  }
}

function readFirstChoiceContent(response, fallback = '') {
  return response?.choices?.[0]?.message?.content?.trim() || fallback;
}

export function buildChatSystemInstructions(systemPrompt, options = {}) {
  const outputLines = options.expectStructuredReply
    ? [
        '# 最终任务',
        '综合上面的角色、会话、记忆、检索和分析数据，生成本轮直接发给 QQ 用户的回复。',
        '只输出一个有效 JSON 对象，不添加解释、前缀、后缀或 Markdown 代码块。',
        '固定字段：text（字符串）、sendVoice（布尔值）、voiceText（字符串）。',
        'text 必须是自然、完整、可直接发送的消息；不要复述内部字段名或上游分析过程。',
        '没有明确语音需求时 sendVoice=false，voiceText=""。',
        '正确示例：{"text":"行，先歇会儿吧，别硬撑。","sendVoice":false,"voiceText":""}',
      ]
    : [
        '# 最终任务',
        '综合上面的上下文，只输出本轮直接发给用户的最终回复。',
        '默认使用中文，不输出分析过程、规则说明、角色标签或 <think>/<thinking>。',
        '除非用户明确要求，否则不使用 Markdown。',
      ];

  return [
    '# 上游上下文',
    systemPrompt,
    '',
    ...outputLines,
  ].join('\n');
}

export async function createEmbeddings(input, options = {}) {
  const startedAt = Date.now();
  const normalizedInput = Array.isArray(input) ? input : [input];
  const operation = options.operation || 'embedding';

  if (isCircuitOpen('embedding')) {
    throw raiseCircuitOpenError(operation, 'embedding');
  }

  try {
    const response = await withRetry(
      () => withTimeout(
        () => embeddingClient.embeddings.create({
          model: options.model || config.embeddingModel,
          input: normalizedInput,
        }),
        options.timeoutMs || config.requestTimeoutMs,
        operation
      ),
      {
        retries: config.retryAttempts,
        delayMs: config.retryDelayMs,
        category: 'model',
        label: 'embeddings',
        logger,
      }
    );

    markModelSuccess('embedding');
    logger.info('model', 'Embeddings finished', {
      traceId: options.traceContext?.traceId,
      operation,
      model: options.model || config.embeddingModel,
      elapsedMs: Date.now() - startedAt,
      inputCount: normalizedInput.length,
    });

    return response.data || [];
  } catch (error) {
    markModelFailure(error, operation, options.traceContext, 'embedding');
    throw error;
  }
}

export async function chat(messages, systemPrompt, userMessage = null, options = {}) {
  const historyLimit = Math.max(0, Number(options.historyLimit ?? 8));
  const conversation = [
    {
      role: 'system',
      content: buildChatSystemInstructions(systemPrompt, options),
    },
    ...messages.slice(-historyLimit),
  ];

  if (userMessage) {
    conversation.push({ role: 'user', content: userMessage });
  } else if (conversation.length === 1) {
    conversation.push({
      role: 'user',
      content: '请按上述设定直接给出一条自然、简洁的中文回复。',
    });
  }

  const response = await createChatCompletion(conversation, {
    ...options,
    responseFormat: options.expectStructuredReply
      ? buildReplyResponseFormat(options)
      : options.responseFormat,
  });
  return readFirstChoiceContent(response, '...');
}

function fallbackAnalysis(text) {
  const sanitized = stripCqCodes(text);
  const sentiment = inferSentiment(sanitized);
  const intent = inferIntent(sanitized);
  const relevance = /(由乃|yuno|你帮我|怎么看|觉得)/i.test(sanitized) ? 0.75 : 0.35;
  const confidence = sanitized ? 0.62 : 0.2;

  return {
    intent,
    sentiment,
    relevance,
    confidence,
    shouldReply: relevance >= 0.45 || intent === 'help',
    reason: 'fallback-heuristic',
    topics: extractTopics(sanitized),
    replyStyle: sentiment === 'negative' ? 'sharp' : sentiment === 'positive' ? 'warm' : 'calm',
  };
}

export async function analyzeMessage(text, context = {}, options = {}) {
  const sanitized = stripCqCodes(text);
  if (!sanitized) {
    return fallbackAnalysis(text);
  }

  const prompt = [
    'Return JSON only.',
    'Fields: intent, sentiment, relevance, confidence, shouldReply, reason, topics, replyStyle.',
    'intent in [help, query, social, challenge, chat, identity, ignore].',
    'sentiment in [positive, neutral, negative].',
    'relevance/confidence are numbers between 0 and 1.',
    `Message: ${sanitized}`,
    `Context: ${JSON.stringify({
      affection: context.affection ?? null,
      activeScore: context.activeScore ?? null,
      groupMood: context.groupMood ?? null,
      groupActivity: context.groupActivity ?? null,
      isAdmin: Boolean(context.isAdmin),
      ruleSignals: context.ruleSignals || [],
    })}`,
  ].join('\n');

  try {
    const response = await createChatCompletion([
      {
        role: 'system',
        content: 'You are a classifier for a QQ bot. Output compact JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ], {
      temperature: 0.2,
      maxTokens: 180,
      traceContext: options.traceContext,
      promptVersion: options.promptVersion || 'message-analysis/v1',
      operation: options.operation || 'analysis',
    });

    const raw = readFirstChoiceContent(response, '{}');
    const parsed = safeJsonParse(raw);
    if (!parsed) {
      return fallbackAnalysis(text);
    }

    return {
      intent: parsed.intent || inferIntent(sanitized),
      sentiment: parsed.sentiment || inferSentiment(sanitized),
      relevance: Number(parsed.relevance) || 0.4,
      confidence: Number(parsed.confidence) || 0.5,
      shouldReply: typeof parsed.shouldReply === 'boolean'
        ? parsed.shouldReply
        : Number(parsed.relevance) >= 0.45,
      reason: parsed.reason || 'llm-analysis',
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 5) : extractTopics(sanitized),
      replyStyle: parsed.replyStyle || 'calm',
    };
  } catch (error) {
    logger.warn('model', 'Message analysis fell back to heuristics', {
      message: error.message,
      status: error.status || error.response?.status,
      code: error.code,
    });
    return fallbackAnalysis(text);
  }
}

function fallbackTriggerClassification(text, context = {}) {
  const sanitized = stripCqCodes(text);
  const question = /[?？]$/.test(sanitized) || /(怎么|如何|为什么|为啥|可以吗|行吗|呢|吗)/i.test(sanitized);
  const keyword = /(帮助|命令|问题|状态|关系|好感|画像|群状态|情绪|设定|规则|世界观|faq)/i.test(sanitized);
  const admin = Boolean(context.isAdmin);
  const shouldRespond = Boolean(admin || question || keyword);

  return {
    shouldRespond,
    confidence: shouldRespond ? 0.72 : 0.55,
    category: keyword ? 'info_query' : question ? 'follow_up' : 'chatter',
    reason: 'fallback-trigger-classifier',
  };
}

export async function classifyReplyTrigger(text, context = {}, options = {}) {
  const sanitized = stripCqCodes(text);
  if (!sanitized) {
    return {
      shouldRespond: false,
      confidence: 0,
      category: 'empty',
      reason: 'empty-message',
    };
  }

  const prompt = [
    'Return JSON only.',
    'Fields: shouldRespond, confidence, category, reason.',
    'category in [info_query, social, command, follow_up, chatter, ignore].',
    `Message: ${sanitized}`,
    `Context: ${JSON.stringify({
      platform: context.platform || 'qq',
      chatType: context.chatType || 'group',
      isAdmin: Boolean(context.isAdmin),
      heuristicScore: context.heuristicScore ?? null,
      directMention: Boolean(context.directMention),
      ruleSignals: context.ruleSignals || [],
      recentSummary: context.recentSummary || '',
    })}`,
  ].join('\n');

  try {
    const response = await createChatCompletion([
      {
        role: 'system',
        content: 'You classify whether a QQ bot should respond. Output compact JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ], {
      temperature: 0.1,
      maxTokens: options.maxTokens ?? 180,
      traceContext: options.traceContext,
      promptVersion: options.promptVersion || 'trigger-classifier/v1',
      operation: options.operation || 'trigger-classifier',
    });

    const raw = readFirstChoiceContent(response, '{}');
    const parsed = safeJsonParse(raw);
    if (!parsed) {
      return fallbackTriggerClassification(text, context);
    }

    return {
      shouldRespond: typeof parsed.shouldRespond === 'boolean'
        ? parsed.shouldRespond
        : Boolean(parsed.should_reply),
      confidence: Number(parsed.confidence) || 0.5,
      category: parsed.category || 'chatter',
      reason: parsed.reason || 'llm-trigger-classifier',
    };
  } catch {
    return fallbackTriggerClassification(text, context);
  }
}

export function resolveTtsVoice(runtimeConfig = config) {
  return String(runtimeConfig.ttsVoice || runtimeConfig.yunoVoiceUri || '').trim();
}

export function resolveTtsVoiceDesign(runtimeConfig = config) {
  return String(runtimeConfig.ttsVoiceDesign || '').trim();
}

export function isMimoVoiceDesignModel(model = '') {
  return String(model || '').trim().toLowerCase() === 'mimo-v2.5-tts-voicedesign';
}

function buildMimoTtsRequest(text, voice, runtimeConfig) {
  const voiceDesignModel = isMimoVoiceDesignModel(runtimeConfig.ttsModel);
  const voiceInstruction = voiceDesignModel
    ? resolveTtsVoiceDesign(runtimeConfig)
    : '用年轻女性、清亮干净、略偏高但不尖的音色朗读。咬字清晰、气息稳定，避免气声、耳语、沙哑和明显呼吸噪声；语速自然，节奏利落，语气专注、敏锐、果断，不慵懒、不甜腻，不要额外补充内容。';

  return {
    url: runtimeConfig.ttsBaseUrl,
    payload: {
      model: runtimeConfig.ttsModel,
      messages: [
        {
          role: 'user',
          content: voiceInstruction,
        },
        {
          role: 'assistant',
          content: text,
        },
      ],
      audio: voiceDesignModel ? { format: 'wav' } : { format: 'wav', voice },
    },
    requestOptions: {
      headers: {
        'api-key': runtimeConfig.ttsApiKey,
        Authorization: `Bearer ${runtimeConfig.ttsApiKey}`,
      },
      maxRedirects: 0,
      timeout: runtimeConfig.requestTimeoutMs,
    },
  };
}

function buildOpenAiCompatibleTtsRequest(text, voice, runtimeConfig) {
  return {
    url: runtimeConfig.ttsBaseUrl,
    payload: {
      model: runtimeConfig.ttsModel,
      input: text,
      voice,
      response_format: 'mp3',
      speed: 1.0,
    },
    requestOptions: {
      headers: { Authorization: `Bearer ${runtimeConfig.ttsApiKey}` },
      maxRedirects: 0,
      responseType: 'arraybuffer',
      timeout: runtimeConfig.requestTimeoutMs,
    },
  };
}

export function buildTtsRequest(text, options = {}, runtimeConfig = config) {
  const provider = String(runtimeConfig.ttsProvider || 'openai_compatible').trim().toLowerCase() || 'openai_compatible';
  const voice = resolveTtsVoice(runtimeConfig);
  const voiceDesignModel = provider === 'mimo' && isMimoVoiceDesignModel(runtimeConfig.ttsModel);
  const voiceDesign = resolveTtsVoiceDesign(runtimeConfig);

  if (!runtimeConfig.enableVoice) {
    return { ok: false, reason: 'voice_disabled', provider };
  }

  if (!voiceDesignModel && !voice) {
    return { ok: false, reason: 'missing_voice_uri', provider };
  }

  if (voiceDesignModel && !voiceDesign) {
    return { ok: false, reason: 'missing_voice_design', provider };
  }

  if (!runtimeConfig.ttsBaseUrl) {
    return { ok: false, reason: 'missing_tts_base_url', provider };
  }

  if (!runtimeConfig.ttsApiKey) {
    return { ok: false, reason: 'missing_tts_api_key', provider };
  }

  return {
    ok: true,
    provider,
    ...(provider === 'mimo'
      ? buildMimoTtsRequest(text, voice, runtimeConfig)
      : buildOpenAiCompatibleTtsRequest(text, voice, runtimeConfig)),
  };
}

export function extractTtsAudioBuffer(response, provider = 'openai_compatible') {
  if (provider === 'mimo') {
    const audioBase64 = response?.data?.choices?.[0]?.message?.audio?.data;
    if (!audioBase64) {
      return null;
    }
    return Buffer.from(audioBase64, 'base64');
  }

  if (!response?.data) {
    return null;
  }

  return Buffer.from(response.data);
}

export async function tts(text, options = {}) {
  const runtimeConfig = options.runtimeConfig || config;
  const request = buildTtsRequest(text, options, runtimeConfig);
  if (!request.ok) {
    logger.info('model', 'TTS skipped', {
      traceId: options.traceContext?.traceId,
      operation: options.operation || 'tts',
      provider: request.provider,
      reason: request.reason,
    });
    return null;
  }

  const startedAt = Date.now();
  const httpPost = options.httpPost || axios.post;
  const response = await withRetry(
    () => httpPost(request.url, request.payload, request.requestOptions),
    {
      retries: runtimeConfig.retryAttempts,
      delayMs: runtimeConfig.retryDelayMs,
      category: 'model',
      label: 'tts',
      logger,
    }
  );

  logger.info('model', 'TTS finished', {
    traceId: options.traceContext?.traceId,
    operation: options.operation || 'tts',
    provider: request.provider,
    elapsedMs: Date.now() - startedAt,
    bytes: request.provider === 'mimo'
      ? response.data?.choices?.[0]?.message?.audio?.data?.length
      : (response.data?.byteLength || response.data?.length),
  });

  return extractTtsAudioBuffer(response, request.provider);
}
