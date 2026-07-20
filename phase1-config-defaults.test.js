import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatCompletionPayload,
  buildChatSystemInstructions,
  buildModelCircuitKey,
  buildOpenAiClientConfig,
  buildReplyResponseFormat,
  buildStructuredReplyResponseFormat,
  chat,
} from './src/minimax.js';

test('model circuit keys isolate primary and fallback reply models', () => {
  assert.equal(
    buildModelCircuitKey('reply', 'gemini-3.5-flash'),
    'reply:gemini-3.5-flash'
  );
  assert.notEqual(
    buildModelCircuitKey('reply', 'gemini-3.5-flash'),
    buildModelCircuitKey('reply', 'gemini-3.1-flash-lite')
  );
  assert.notEqual(
    buildModelCircuitKey('reply', 'gemini-3.5-flash'),
    buildModelCircuitKey('chat', 'gemini-3.5-flash')
  );
});

async function loadConfigModule(overrides = {}) {
  const keys = Object.keys(overrides);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }

  try {
    return await import(new URL(`./src/config.js?case=${Date.now()}-${Math.random()}`, import.meta.url));
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('config disables voice by default when ENABLE_VOICE is not explicitly enabled', async () => {
  const { config } = await loadConfigModule({
    ENABLE_VOICE: '',
  });

  assert.equal(config.enableVoice, false);
});

test('config uses openai-compatible tts provider by default and prefers TTS_VOICE', async () => {
  const { config } = await loadConfigModule({
    TTS_PROVIDER: '',
    TTS_VOICE: 'mimo_voice',
    YUNO_VOICE_URI: 'legacy_voice',
  });

  assert.equal(config.ttsProvider, 'openai_compatible');
  assert.equal(config.ttsVoice, 'mimo_voice');
});

test('config enables deterministic daily mood in Asia Shanghai by default', async () => {
  const { config } = await loadConfigModule({
    BOT_DAILY_MOOD_ENABLED: '',
    BOT_DAILY_MOOD_SEED: '',
    BOT_DAILY_MOOD_TIMEZONE: '',
    BOT_DAILY_MOOD_OVERRIDE: '',
  });

  assert.equal(config.dailyMoodEnabled, true);
  assert.equal(config.dailyMoodSeed, 'yuno-daily-mood-v1');
  assert.equal(config.dailyMoodTimezone, 'Asia/Shanghai');
  assert.equal(config.dailyMoodOverride, '');
});

test('config falls back to YUNO_VOICE_URI when TTS_VOICE is missing', async () => {
  const { config } = await loadConfigModule({
    TTS_VOICE: '',
    YUNO_VOICE_URI: 'legacy_voice',
  });

  assert.equal(config.ttsVoice, 'legacy_voice');
});

test('config uses mimo defaults when TTS_PROVIDER is mimo', async () => {
  const { config } = await loadConfigModule({
    TTS_PROVIDER: 'mimo',
    TTS_BASE_URL: '',
    TTS_MODEL: '',
    TTS_VOICE_DESIGN: '',
  });

  assert.equal(config.ttsProvider, 'mimo');
  assert.equal(config.ttsBaseUrl, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(config.ttsModel, 'mimo-v2.5-tts');
  assert.equal(config.ttsSpeed, 1.15);
  assert.match(config.ttsVoiceDesign, /避免气声、耳语、沙哑和明显呼吸噪声/);
  assert.match(config.ttsVoiceDesign, /不慵懒、不甜腻、不夹/);
});

test('config trims qdrant url and diagnoses missing protocol', async () => {
  const { config, describeHttpBaseUrlProblem } = await loadConfigModule({
    QDRANT_URL: ' qdrant:6333/ ',
  });

  assert.equal(config.qdrantUrl, 'qdrant:6333');
  assert.equal(describeHttpBaseUrlProblem(config.qdrantUrl), 'missing-protocol');
});

test('config exposes independent embedding provider settings', async () => {
  const { config } = await loadConfigModule({
    LLM_API_KEY: 'chat-key',
    LLM_BASE_URL: 'https://api.minimaxi.com/v1',
    EMBEDDING_API_KEY: 'embedding-key',
    EMBEDDING_BASE_URL: 'https://api.openai.com/v1/',
    EMBEDDING_MODEL: 'text-embedding-3-small',
    QDRANT_MIN_SCORE: '',
  });

  assert.equal(config.embeddingApiKey, 'embedding-key');
  assert.equal(config.embeddingBaseUrl, 'https://api.openai.com/v1');
  assert.equal(config.embeddingModel, 'text-embedding-3-small');
  assert.equal(config.qdrantMinScore, 0.25);
});

test('embedding OpenAI client config uses embedding provider instead of chat provider', () => {
  const clientConfig = buildOpenAiClientConfig('embedding', {
    llmApiKey: 'chat-key',
    llmBaseUrl: 'https://api.minimaxi.com/v1',
    embeddingApiKey: 'embedding-key',
    embeddingBaseUrl: 'https://api.openai.com/v1',
    requestTimeoutMs: 15000,
  });

  assert.equal(clientConfig.apiKey, 'embedding-key');
  assert.equal(clientConfig.baseURL, 'https://api.openai.com/v1');
  assert.equal(clientConfig.timeout, 15000);
});

test('GEMINI_API_KEY alone selects the official Gemini 3.5 Flash OpenAI-compatible defaults', async () => {
  const { config } = await loadConfigModule({
    LLM_API_KEY: '',
    OPENAI_API_KEY: '',
    SILICONFLOW_API_KEY: '',
    LLM_BASE_URL: '',
    OPENAI_BASE_URL: '',
    LLM_CHAT_MODEL: '',
    REPLY_LLM_API_KEY: '',
    REPLY_LLM_BASE_URL: '',
    REPLY_LLM_CHAT_MODEL: '',
    GEMINI_API_KEY: 'gemini-key',
  });

  assert.equal(config.llmApiKey, 'gemini-key');
  assert.equal(config.llmBaseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(config.llmChatModel, 'gemini-3.5-flash');
  assert.equal(config.replyLlmApiKey, 'gemini-key');
  assert.equal(config.replyLlmBaseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(config.replyLlmChatModel, 'gemini-3.5-flash');
});
test('config exposes an independent Gemini final-reply provider', async () => {
  const { config } = await loadConfigModule({
    LLM_API_KEY: 'analysis-key',
    LLM_BASE_URL: 'https://analysis.example/v1',
    LLM_CHAT_MODEL: 'analysis-model',
    REPLY_LLM_API_KEY: 'gemini-key',
    REPLY_LLM_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    REPLY_LLM_CHAT_MODEL: 'gemini-3.5-flash',
    REPLY_LLM_REASONING_EFFORT: 'minimal',
    REPLY_LLM_KNOWLEDGE_REASONING_EFFORT: 'low',
    REPLY_LLM_STRUCTURED_OUTPUT: 'true',
    MODEL_FALLBACK_CHAT_MODEL: 'upstream-only-fallback',
    REPLY_LLM_FALLBACK_CHAT_MODEL: '',
  });

  assert.equal(config.llmChatModel, 'analysis-model');
  assert.equal(config.replyLlmApiKey, 'gemini-key');
  assert.equal(config.replyLlmBaseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(config.replyLlmChatModel, 'gemini-3.5-flash');
  assert.equal(config.replyLlmReasoningEffort, 'minimal');
  assert.equal(config.replyLlmKnowledgeReasoningEffort, 'low');
  assert.equal(config.replyLlmStructuredOutput, true);
  assert.equal(config.replyLlmFallbackChatModel, '');
});

test('reply OpenAI client config stays independent from analysis and embedding providers', () => {
  const clientConfig = buildOpenAiClientConfig('reply', {
    llmApiKey: 'analysis-key',
    llmBaseUrl: 'https://analysis.example/v1',
    replyLlmApiKey: 'gemini-key',
    replyLlmBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requestTimeoutMs: 15000,
  });

  assert.equal(clientConfig.apiKey, 'gemini-key');
  assert.equal(clientConfig.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(clientConfig.timeout, 15000);
});

test('fallback reply client can use an independent provider', () => {
  const clientConfig = buildOpenAiClientConfig('reply-fallback', {
    llmApiKey: 'analysis-key',
    llmBaseUrl: 'https://analysis.example/v1',
    replyLlmApiKey: 'gemini-key',
    replyLlmBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    replyLlmFallbackApiKey: 'siliconflow-key',
    replyLlmFallbackBaseUrl: 'https://api.siliconflow.cn/v1',
    requestTimeoutMs: 15000,
  });

  assert.equal(clientConfig.apiKey, 'siliconflow-key');
  assert.equal(clientConfig.baseURL, 'https://api.siliconflow.cn/v1');
  assert.equal(clientConfig.timeout, 15000);
});

test('fallback chat builds its payload before deriving the circuit key', async () => {
  let capturedPayload = null;
  const output = await chat([], 'Return JSON only.', '确认备用模型可用。', {
    providerKind: 'reply-fallback',
    model: 'gemini-3.1-flash-lite',
    expectStructuredReply: true,
    maxTokens: 80,
    temperature: 0,
    client: {
      chat: {
        completions: {
          create: async (payload) => {
            capturedPayload = payload;
            return {
              choices: [{
                message: {
                  content: '{"text":"备用模型可用。","sendVoice":false,"voiceText":""}',
                },
              }],
              usage: {},
            };
          },
        },
      },
    },
  });

  assert.equal(capturedPayload.model, 'gemini-3.1-flash-lite');
  assert.equal(capturedPayload.max_tokens, 80);
  assert.equal(output, '{"text":"备用模型可用。","sendVoice":false,"voiceText":""}');
});

test('non-Gemini fallback provider uses JSON object response mode', () => {
  const responseFormat = buildReplyResponseFormat({
    providerKind: 'reply-fallback',
    model: 'Qwen/Qwen3-8B',
  });

  assert.deepEqual(responseFormat, { type: 'json_object' });
});

test('Gemini final-reply payload uses strict JSON schema and explicit reasoning effort', () => {
  const responseFormat = buildStructuredReplyResponseFormat();
  const payload = buildChatCompletionPayload([
    { role: 'user', content: '测试' },
  ], {
    providerKind: 'reply',
    model: 'gemini-3.5-flash',
    reasoningEffort: 'minimal',
    responseFormat,
    maxTokens: 240,
  });

  assert.equal(payload.model, 'gemini-3.5-flash');
  assert.equal(payload.reasoning_effort, 'minimal');
  assert.equal(payload.max_tokens, 240);
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.deepEqual(payload.response_format.json_schema.schema.required, ['text', 'sendVoice', 'voiceText']);
  assert.equal(payload.response_format.json_schema.schema.additionalProperties, false);
});

test('non-Gemini reply providers keep the legacy JSON object response mode', () => {
  const responseFormat = buildReplyResponseFormat({
    model: 'MiniMax-M2.7',
  });

  assert.deepEqual(responseFormat, { type: 'json_object' });
});
test('Gemini final prompt places upstream data before the final generation task', () => {
  const prompt = buildChatSystemInstructions('上游分析数据\n- intent=chat', {
    expectStructuredReply: true,
  });

  assert.ok(prompt.indexOf('# 上游上下文') < prompt.indexOf('# 最终任务'));
  assert.match(prompt, /不要复述内部字段名或上游分析过程/);
  assert.match(prompt, /只输出一个有效 JSON 对象/);
});
test('config exposes companion experience and external enhancement knobs', async () => {
  const { config } = await loadConfigModule({
    BOT_EXPERIENCE_MODE: '',
    REPLY_HARD_TIMEOUT_MS: '',
    EXTERNAL_TOOL_TIMEOUT_MS: '',
    MEMORY_EXTRACTION_ENABLED: '',
    MEME_VISION_ENABLED: '',
  });

  assert.equal(config.botExperienceMode, 'companion');
  assert.equal(config.replyHardTimeoutMs, 12000);
  assert.equal(config.externalToolTimeoutMs, 4000);
  assert.equal(config.memoryExtractionEnabled, true);
  assert.equal(config.memeVisionEnabled, true);
  assert.equal(config.maxActiveRemindersPerUser, 20);
  assert.equal(config.maxActiveSubscriptionsPerUser, 10);
});

test('config exposes contextual meme auto-send controls', async () => {
  const { config } = await loadConfigModule({
    MEME_AUTO_SEND_MODE: 'suggest',
    MEME_AUTO_SEND_COOLDOWN_MS: '120000',
    MEME_AUTO_SEND_MIN_SCORE: '0.8',
    MEME_AUTO_SEND_MAX_PER_HOUR: '2',
    MEME_AUTO_SEND_PROBABILITY: '0.4',
    MEME_PROVIDER: 'napcat-favorites',
    MEME_IMPORT_DIR: 'custom/memes',
    MEME_NAPCAT_FAVORITES_COUNT: '24',
    MEME_NAPCAT_FAVORITES_SYNC_TTL_MS: '30000',
  });

  assert.equal(config.memeAutoSendMode, 'suggest');
  assert.equal(config.memeAutoSendCooldownMs, 120000);
  assert.equal(config.memeAutoSendMinScore, 0.8);
  assert.equal(config.memeAutoSendMaxPerHour, 2);
  assert.equal(config.memeAutoSendProbability, 0.4);
  assert.equal(config.memeProvider, 'napcat-favorites');
  assert.equal(config.memeImportDir, 'custom/memes');
  assert.equal(config.memeNapcatFavoritesCount, 24);
  assert.equal(config.memeNapcatFavoritesSyncTtlMs, 30000);
});

test('config clamps meme auto-send probability to a safe range', async () => {
  const high = await loadConfigModule({ MEME_AUTO_SEND_PROBABILITY: '2' });
  const low = await loadConfigModule({ MEME_AUTO_SEND_PROBABILITY: '-1' });
  const fallback = await loadConfigModule({ MEME_AUTO_SEND_PROBABILITY: 'not-a-number' });

  assert.equal(high.config.memeAutoSendProbability, 1);
  assert.equal(low.config.memeAutoSendProbability, 0);
  assert.equal(fallback.config.memeAutoSendProbability, 0.25);
});

test('config exposes webhook and metrics security defaults', async () => {
  const { config } = await loadConfigModule({
    ONEBOT_WEBHOOK_SECRET: '',
    WEBHOOK_BODY_LIMIT: '',
    METRICS_AUTH_TOKEN: '',
    METRICS_PATH: '/metrics',
  });

  assert.equal(config.onebotWebhookSecret, '');
  assert.equal(config.webhookBodyLimit, '128kb');
  assert.equal(config.metricsAuthToken, '');
  assert.equal(config.metricsPath, '/metrics');
});

test('config falls back from unsafe metrics route patterns', async () => {
  const { config } = await loadConfigModule({
    METRICS_PATH: '/:bad(.*)',
  });

  assert.equal(config.metricsPath, '/metrics');
});
