import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAiClientConfig } from './src/minimax.js';

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
