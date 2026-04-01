import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueManager } from './src/queue-manager.js';

test('inline queue deduplicates reply jobs by job id', async () => {
  const handled = [];
  const queueManager = await createQueueManager({
    enableQueue: false,
    redisUrl: '',
    replyQueueName: 'reply_job',
    persistQueueName: 'persist_job',
    queueRetryAttempts: 1,
    queueBackoffMs: 10,
    queueConcurrency: { default: 1, reply: 1, persist: 1 },
  }, {
    replyJob: async (payload) => {
      handled.push(payload.id);
    },
    persistJob: async () => {},
  });

  await queueManager.enqueueReply({ id: 'm1' }, { jobId: 'reply:1' });
  const duplicate = await queueManager.enqueueReply({ id: 'm1' }, { jobId: 'reply:1' });

  assert.equal(handled.length, 1);
  assert.equal(duplicate.deduplicated, true);
});

test('inline queue prunes expired dedup entries', async () => {
  const handled = [];
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  try {
    const queueManager = await createQueueManager({
      enableQueue: false,
      redisUrl: '',
      replyQueueName: 'reply_job',
      persistQueueName: 'persist_job',
      queueRetryAttempts: 1,
      queueBackoffMs: 10,
      queueConcurrency: { default: 1, reply: 1, persist: 1 },
    }, {
      replyJob: async (payload) => {
        handled.push(payload.id);
      },
      persistJob: async () => {},
    });

    await queueManager.enqueueReply({ id: 'm1' }, { jobId: 'reply:1' });
    now += 6 * 60 * 1000;
    const second = await queueManager.enqueueReply({ id: 'm2' }, { jobId: 'reply:1' });

    assert.equal(handled.length, 2);
    assert.equal(second.deduplicated, undefined);
  } finally {
    Date.now = originalNow;
  }
});
