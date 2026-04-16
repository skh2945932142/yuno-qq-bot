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

const client = new OpenAI({
  apiKey: config.llmApiKey,
  baseURL: config.llmBaseUrl,
});

const breakerState = {
  consecutiveFailures: 0,
  openUntil: 0,
};

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

function isCircuitOpen() {
  return Date.now() < breakerState.openUntil;
}

function raiseCircuitOpenError(operation) {
  const remainingMs = Math.max(0, breakerState.openUntil - Date.now());
  const error = new Error(`Model circuit open for ${remainingMs}ms`);
  error.code = 'MODEL_CIRCUIT_OPEN';
  error.operation = operation;
  error.retryAfterMs = remainingMs;
  return error;
}

function markModelSuccess() {
  breakerState.consecutiveFailures = 0;
  breakerState.openUntil = 0;
}

function markModelFailure(error, operation, traceContext) {
  if (error?.code === 'MODEL_CIRCUIT_OPEN') return;

  breakerState.consecutiveFailures += 1;
  const threshold = Math.max(2, Number(config.modelCircuitFailureThreshold || 3));
  if (breakerState.consecutiveFailures < threshold) return;

  const openMs = Math.max(5000, Number(config.modelCircuitOpenMs || 20000));
  breakerState.openUntil = Date.now() + openMs;
  breakerState.consecutiveFailures = 0;

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

async function createChatCompletion(messages, options = {}) {
  const startedAt = Date.now();
  const operation = options.operation || 'chat';
  const payload = {
    model: options.model || config.llmChatModel,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 256,
  };

  if (options.responseFormat) {
    payload.response_format = options.responseFormat;
  }

  if (options.stop) {
    payload.stop = options.stop;
  }

  if (!payload.model) {
    throw new Error('Missing LLM chat model configuration');
  }

  if (isCircuitOpen()) {
    throw raiseCircuitOpenError(operation);
  }

  try {
    const response = await withRetry(
      () => withTimeout(
        () => client.chat.completions.create(payload),
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

    markModelSuccess();
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
    markModelFailure(error, operation, options.traceContext);
    throw error;
  }
}

function readFirstChoiceContent(response, fallback = '') {
  return response?.choices?.[0]?.message?.content?.trim() || fallback;
}

export async function createEmbeddings(input, options = {}) {
  const startedAt = Date.now();
  const normalizedInput = Array.isArray(input) ? input : [input];
  const operation = options.operation || 'embedding';

  if (isCircuitOpen()) {
    throw raiseCircuitOpenError(operation);
  }

  try {
    const response = await withRetry(
      () => withTimeout(
        () => client.embeddings.create({
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

    markModelSuccess();
    logger.info('model', 'Embeddings finished', {
      traceId: options.traceContext?.traceId,
      operation,
      model: options.model || config.embeddingModel,
      elapsedMs: Date.now() - startedAt,
      inputCount: normalizedInput.length,
    });

    return response.data || [];
  } catch (error) {
    markModelFailure(error, operation, options.traceContext);
    throw error;
  }
}

export async function chat(messages, systemPrompt, userMessage = null, options = {}) {
  const historyLimit = Math.max(0, Number(options.historyLimit ?? 8));
  const conversation = [
    {
      role: 'system',
      content: [
        '只输出最终回复文本。',
        '默认使用中文，除非用户明确要求英文。',
        '不要输出分析过程、规则说明、角色标签，不要输出 <think>/<thinking>。',
        '先回答用户当前这句话，再补一层必要延展。',
        systemPrompt,
      ].join('\n'),
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

  const response = await createChatCompletion(conversation, options);
  return readFirstChoiceContent(response, '...');
}

function fallbackAnalysis(text) {
  const sanitized = stripCqCodes(text);
  const sentiment = inferSentiment(sanitized);
  const intent = inferIntent(sanitized);
  const relevance = /(由乃|yuno|你|帮我|怎么看|觉得)/i.test(sanitized) ? 0.75 : 0.35;
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
  const question = /[?？]$/.test(sanitized) || /(怎么|如何|为什么|为啥|可以吗|行吗|呢|吗)\b/i.test(sanitized);
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

export async function tts(text, options = {}) {
  if (!config.enableVoice || !config.yunoVoiceUri || !config.ttsBaseUrl || !config.ttsApiKey) {
    logger.info('model', 'TTS skipped', {
      traceId: options.traceContext?.traceId,
      operation: options.operation || 'tts',
      reason: !config.enableVoice
        ? 'voice_disabled'
        : !config.yunoVoiceUri
          ? 'missing_voice_uri'
          : !config.ttsBaseUrl
            ? 'missing_tts_base_url'
            : 'missing_tts_api_key',
    });
    return null;
  }

  const startedAt = Date.now();
  const response = await withRetry(
    () => axios.post(
      config.ttsBaseUrl,
      {
        model: config.ttsModel,
        input: text,
        voice: config.yunoVoiceUri,
        response_format: 'mp3',
        speed: 1.0,
      },
      {
        headers: { Authorization: `Bearer ${config.ttsApiKey}` },
        responseType: 'arraybuffer',
        timeout: config.requestTimeoutMs,
      }
    ),
    {
      retries: config.retryAttempts,
      delayMs: config.retryDelayMs,
      category: 'model',
      label: 'tts',
      logger,
    }
  );

  logger.info('model', 'TTS finished', {
    traceId: options.traceContext?.traceId,
    operation: options.operation || 'tts',
    elapsedMs: Date.now() - startedAt,
    bytes: response.data?.byteLength || response.data?.length,
  });

  return Buffer.from(response.data);
}

