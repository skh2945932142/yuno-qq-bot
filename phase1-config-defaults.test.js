import test from 'node:test';
import assert from 'node:assert/strict';

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
  });

  assert.equal(config.ttsProvider, 'mimo');
  assert.equal(config.ttsBaseUrl, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(config.ttsModel, 'mimo-v2.5-tts');
});

test('config trims qdrant url and diagnoses missing protocol', async () => {
  const { config, describeHttpBaseUrlProblem } = await loadConfigModule({
    QDRANT_URL: ' qdrant:6333/ ',
  });

  assert.equal(config.qdrantUrl, 'qdrant:6333');
  assert.equal(describeHttpBaseUrlProblem(config.qdrantUrl), 'missing-protocol');
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
});
