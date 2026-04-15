import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQdrant, checkVoiceRuntime, runCheck } from './doctor.js';

test('doctor marks voice as skip when voice is disabled', async () => {
  const result = await checkVoiceRuntime({
    config: {
      enableVoice: false,
    },
  });

  assert.equal(result.status, 'skip');
  assert.match(result.detail, /text-only mode/i);
});

test('doctor marks qdrant as skip when retrieval is not configured', async () => {
  const result = await checkQdrant({
    config: {
      qdrantUrl: '',
      qdrantCollection: '',
      qdrantApiKey: '',
      requestTimeoutMs: 1000,
    },
  });

  assert.equal(result.status, 'skip');
  assert.match(result.detail, /text-only mode/i);
});

test('doctor marks qdrant as fail when configured endpoint is unreachable', async () => {
  const result = await runCheck('qdrant', () => checkQdrant({
    config: {
      qdrantUrl: 'http://127.0.0.1:6333',
      qdrantCollection: 'qq_bot_knowledge',
      qdrantApiKey: '',
      requestTimeoutMs: 1000,
    },
    httpGet: async () => {
      const error = new Error('bad gateway');
      error.response = { status: 502 };
      throw error;
    },
  }));

  assert.equal(result.status, 'fail');
  assert.match(result.detail, /bad gateway/i);
});
