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
