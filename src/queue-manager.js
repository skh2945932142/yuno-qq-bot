import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';

const DEFAULT_QUEUE_STATUS = {
  enabled: false,
  mode: 'inline',
  ready: true,
  provider: 'inline',
};

function createInlineQueueManager() {
  const seenJobIds = new Map();
  const DEDUP_TTL_MS = 5 * 60 * 1000;

  function pruneExpired() {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [jobId, timestamp] of seenJobIds) {
      if (timestamp < cutoff) {
        seenJobIds.delete(jobId);
      }
    }
  }

  return {
    status: { ...DEFAULT_QUEUE_STATUS },
    async enqueue(name, data, handler, options = {}) {
      pruneExpired();
      if (options.jobId && seenJobIds.has(options.jobId)) {
        recordWorkflowMetric('yuno_queue_deduplicated_total', 1, { queue: name, mode: 'inline' });
        return { id: options.jobId, deduplicated: true };
      }
      if (options.jobId) {
        seenJobIds.set(options.jobId, Date.now());
      }
      recordWorkflowMetric('yuno_queue_jobs_total', 1, { queue: name, mode: 'inline' });
      await handler(data, {
        name,
        id: options.jobId || `${name}:${Date.now()}`,
        queueName: name,
        attemptsMade: 0,
        mode: 'inline',
      });
      return { id: options.jobId || `${name}:inline` };
    },
    async close() {},
  };
}

async function createBullQueueManager(config) {
  try {
    const [{ Queue, Worker }, { default: IORedis }] = await Promise.all([
      import('bullmq'),
      import('ioredis'),
    ]);

    const connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    const queues = new Map();
    const workers = [];

    function getQueue(name) {
      if (!queues.has(name)) {
        queues.set(name, new Queue(name, { connection }));
      }
      return queues.get(name);
    }

    return {
      status: {
        enabled: true,
        mode: 'bullmq',
        ready: true,
        provider: 'bullmq',
      },
      registerWorker(name, handler, options = {}) {
        const worker = new Worker(name, async (job) => handler(job.data, {
          id: String(job.id || ''),
          name,
          queueName: name,
          attemptsMade: job.attemptsMade,
          mode: 'bullmq',
        }), {
          connection,
          concurrency: options.concurrency || config.queueConcurrency.default,
        });
        worker.on('completed', async () => {
          recordWorkflowMetric('yuno_queue_completed_total', 1, { queue: name });
        });
        worker.on('failed', async (_job, error) => {
          recordWorkflowMetric('yuno_queue_failed_total', 1, { queue: name });
          logger.warn('queue', 'Worker job failed', {
            queue: name,
            message: error.message,
          });
        });
        workers.push(worker);
        return worker;
      },
      async enqueue(name, data, _handler, options = {}) {
        recordWorkflowMetric('yuno_queue_jobs_total', 1, { queue: name, mode: 'bullmq' });
        const queue = getQueue(name);
        try {
          const job = await queue.add(name, data, {
            jobId: options.jobId,
            attempts: options.attempts ?? config.queueRetryAttempts,
            backoff: {
              type: 'exponential',
              delay: options.backoffDelayMs ?? config.queueBackoffMs,
            },
            removeOnComplete: 1000,
            removeOnFail: 1000,
          });
          return job;
        } catch (error) {
          if (error.message?.includes('Job is already waiting') || error.message?.includes('jobId')) {
            recordWorkflowMetric('yuno_queue_deduplicated_total', 1, { queue: name, mode: 'bullmq' });
            return { id: options.jobId, deduplicated: true };
          }
          throw error;
        }
      },
      async close() {
        await Promise.all(workers.map((worker) => worker.close()));
        await Promise.all([...queues.values()].map((queue) => queue.close()));
        await connection.quit();
      },
    };
  } catch (error) {
    logger.warn('queue', 'BullMQ not available, falling back to inline mode', {
      message: error.message,
    });
    return createInlineQueueManager();
  }
}

export async function createQueueManager(config, handlers = {}) {
  const manager = config.enableQueue && config.redisUrl
    ? await createBullQueueManager(config)
    : createInlineQueueManager();

  if (manager.status.mode === 'bullmq') {
    manager.registerWorker(config.replyQueueName, handlers.replyJob, {
      concurrency: config.queueConcurrency.reply,
    });
    manager.registerWorker(config.persistQueueName, handlers.persistJob, {
      concurrency: config.queueConcurrency.persist,
    });
  }

  return {
    async enqueueReply(data, options = {}) {
      return manager.enqueue(config.replyQueueName, data, handlers.replyJob, options);
    },
    async enqueuePersist(data, options = {}) {
      return manager.enqueue(config.persistQueueName, data, handlers.persistJob, options);
    },
    async close() {
      return manager.close();
    },
    getStatus() {
      return { ...manager.status };
    },
  };
}
