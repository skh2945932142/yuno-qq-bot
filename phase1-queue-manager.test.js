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
