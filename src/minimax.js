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
  apiKey: config.siliconflowApiKey,
  baseURL: 'https://api.siliconflow.cn/v1',
});

async function createChatCompletion(messages, options = {}) {
  const payload = {
    model: 'Pro/MiniMaxAI/MiniMax-M2.5',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 256,
  };

  if (options.responseFormat) {
    payload.response_format = options.responseFormat;
  }

  return withRetry(
    () => client.chat.completions.create(payload),
    {
      retries: config.retryAttempts,
      delayMs: config.retryDelayMs,
      category: 'model',
      label: 'chat completion',
      logger,
    }
  );
}

export async function chat(messages, systemPrompt, userMessage = null) {
  const conversation = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-20),
  ];

  if (userMessage) {
    conversation.push({ role: 'user', content: userMessage });
  } else if (conversation.length === 1) {
    conversation.push({
      role: 'user',
      content: '请基于上面的设定直接生成一条自然、简短的回复。',
    });
  }

  const response = await createChatCompletion(conversation);
  return response.choices[0]?.message?.content?.trim() || '...';
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

export async function analyzeMessage(text, context = {}) {
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
    });

    const raw = response.choices[0]?.message?.content || '{}';
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

export async function tts(text) {
  if (!config.yunoVoiceUri) {
    return null;
  }

  const response = await withRetry(
    () => axios.post(
      'https://api.siliconflow.cn/v1/audio/speech',
      {
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        input: text,
        voice: config.yunoVoiceUri,
        response_format: 'mp3',
        speed: 1.0,
      },
      {
        headers: { Authorization: `Bearer ${config.siliconflowApiKey}` },
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

  return Buffer.from(response.data);
}
