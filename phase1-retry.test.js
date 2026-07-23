import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './src/retry.js';

test('withRetry returns immediately on success and passes the attempt index', async () => {
  const attempts = [];
  const result = await withRetry(async (attempt) => {
    attempts.push(attempt);
    return 'ok';
  }, { retries: 3, delayMs: 0 });
  assert.equal(result, 'ok');
  assert.deepEqual(attempts, [0]);
});

test('withRetry retries retryable HTTP and network errors', async () => {
  const warnings = [];
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('rate limited');
      error.response = { status: 429 };
      throw error;
    }
    if (calls === 2) {
      const error = new Error('reset');
      error.code = 'ECONNRESET';
      throw error;
    }
    return 'recovered';
  }, {
    retries: 2,
    delayMs: 0,
    category: 'model',
    label: 'reply',
    logger: { warn: (...args) => warnings.push(args) },
  });

  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0][2].status, 429);
  assert.equal(warnings[1][2].code, 'ECONNRESET');
});

test('withRetry fails immediately for non-retryable errors', async () => {
  let calls = 0;
  await assert.rejects(() => withRetry(async () => {
    calls += 1;
    const error = new Error('bad request');
    error.response = { status: 400 };
    throw error;
  }, { retries: 3, delayMs: 0 }), /bad request/);
  assert.equal(calls, 1);
});

test('withRetry throws the last error after retry exhaustion', async () => {
  let calls = 0;
  await assert.rejects(() => withRetry(async () => {
    calls += 1;
    const error = new Error(`timeout-${calls}`);
    error.code = 'ETIMEDOUT';
    throw error;
  }, { retries: 2, delayMs: 0 }), /timeout-3/);
  assert.equal(calls, 3);
});
