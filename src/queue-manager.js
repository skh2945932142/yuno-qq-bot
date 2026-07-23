import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';

const DEFAULT_QUEUE_STATUS = {
  enabled: false,
  mode: 'inline',
  ready: true,
  provider: 'inline',
};

function createInlineQueueManager(deps = {}, statusOverrides = {}) {
  const seenJobIds = new Map();
  const DEDUP_TTL_MS = 5 * 60 * 1000;
  const now = deps.now || Date.now;
  const recordMetric = deps.recordWorkflowMetric || recordWorkflowMetric;
  const loggerImpl = deps.logger || logger;

  function pruneExpired() {
    const cutoff = now() - DEDUP_TTL_MS;
    for (const [jobId, timestamp] of seenJobIds) {
      if (timestamp < cutoff) {
        seenJobIds.delete(jobId);
      }
    }
  }

  return {
    status: { ...DEFAULT_QUEUE_STATUS, ...statusOverrides },
    async enqueue(name, data, handler, options = {}) {
      pruneExpired();
      if (options.jobId && seenJobIds.has(options.jobId)) {
        recordMetric('yuno_queue_deduplicated_total', 1, { queue: name, mode: 'inline' });
        return { id: options.jobId, deduplicated: true };
      }
      if (options.jobId) {
        seenJobIds.set(options.jobId, now());
      }
      recordMetric('yuno_queue_jobs_total', 1, { queue: name, mode: 'inline' });
      const job = {
        name,
        id: options.jobId || `${name}:${now()}`,
        queueName: name,
        attemptsMade: 0,
        mode: 'inline',
      };
      if (options.waitForCompletion === false) {
        Promise.resolve()
          .then(() => handler(data, job))
          .catch((error) => {
            if (options.jobId) {
              seenJobIds.delete(options.jobId);
            }
            recordMetric('yuno_queue_failed_total', 1, { queue: name, mode: 'inline' });
            loggerImpl.warn('queue', 'Detached inline job failed', {
              queue: name,
              jobId: job.id,
              message: error.message,
            });
          });
        return {
          id: job.id,
          detached: true,
        };
      }

      await handler(data, job);

      return { id: options.jobId || `${name}:inline` };
    },
    async close() {},
  };
}


async function probeRedisConnection(connection, timeoutMs = 3000) {
  if (typeof connection?.ping !== 'function') {
    return;
  }

  let timeout;
  try {
    await Promise.race([
      connection.ping(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Redis readiness probe timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
async function createBullQueueManager(config, deps = {}) {
  let connection = null;
  try {
    const loadBullMq = deps.loadBullMq || (() => import('bullmq'));
    const loadIORedis = deps.loadIORedis || (() => import('ioredis'));
    const [{ Queue, Worker }, { default: IORedis }] = await Promise.all([
      loadBullMq(),
      loadIORedis(),
    ]);
    const loggerImpl = deps.logger || logger;
    const recordMetric = deps.recordWorkflowMetric || recordWorkflowMetric;

    connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    await probeRedisConnection(connection, config.queueConnectTimeoutMs || 3000);

    const status = {
      enabled: true,
      mode: 'bullmq',
      ready: true,
      provider: 'bullmq',
    };
    if (typeof connection.on === 'function') {
      connection.on('ready', () => {
        status.ready = true;
        delete status.reason;
      });
      const markUnavailable = (reason) => {
        status.ready = false;
        status.reason = String(reason || 'redis-connection-unavailable');
      };
      connection.on('close', () => markUnavailable('redis-connection-closed'));
      connection.on('end', () => markUnavailable('redis-connection-ended'));
      connection.on('error', (error) => markUnavailable(error?.message));
    }

    const queues = new Map();
    const workers = [];

    function getQueue(name) {
      if (!queues.has(name)) {
        queues.set(name, new Queue(name, { connection }));
      }
      return queues.get(name);
    }

    return {
      status,
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
          recordMetric('yuno_queue_completed_total', 1, { queue: name });
        });
        worker.on('failed', async (_job, error) => {
          recordMetric('yuno_queue_failed_total', 1, { queue: name });
          loggerImpl.warn('queue', 'Worker job failed', {
            queue: name,
            message: error.message,
          });
        });
        workers.push(worker);
        return worker;
      },
      async enqueue(name, data, _handler, options = {}) {
        recordMetric('yuno_queue_jobs_total', 1, { queue: name, mode: 'bullmq' });
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
          status.ready = true;
          delete status.reason;
          return job;
        } catch (error) {
          if (error.message?.includes('Job is already waiting') || error.message?.includes('jobId')) {
            recordMetric('yuno_queue_deduplicated_total', 1, { queue: name, mode: 'bullmq' });
            return { id: options.jobId, deduplicated: true };
          }
          status.ready = false;
          status.reason = error.message;
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
    if (connection) {
      if (typeof connection.disconnect === 'function') {
        connection.disconnect();
      } else if (typeof connection.quit === 'function') {
        await connection.quit().catch(() => {});
      }
    }
    if (deps.allowInlineFallback === false) {
      throw error;
    }
    (deps.logger || logger).warn('queue', 'BullMQ not available, falling back to inline mode', {
      message: error.message,
    });
    return createInlineQueueManager(deps, {
      degraded: true,
      reason: error.message,
    });
  }
}

export async function createQueueManager(config, handlers = {}, deps = {}) {
  const manager = config.enableQueue && config.redisUrl
    ? await createBullQueueManager(config, deps)
    : createInlineQueueManager(deps);
  const workers = {
    reply: handlers.workers?.reply !== false,
    persist: handlers.workers?.persist !== false,
  };
  const registeredWorkers = [];
  let workersStarted = false;

  function startWorkers() {
    if (workersStarted || manager.status.mode !== 'bullmq') {
      return [...registeredWorkers];
    }
    workersStarted = true;
    if (workers.reply && typeof handlers.replyJob === 'function') {
      manager.registerWorker(config.replyQueueName, handlers.replyJob, {
        concurrency: config.queueConcurrency.reply,
      });
      registeredWorkers.push('reply');
    }
    if (workers.persist && typeof handlers.persistJob === 'function') {
      manager.registerWorker(config.persistQueueName, handlers.persistJob, {
        concurrency: config.queueConcurrency.persist,
      });
      registeredWorkers.push('persist');
    }
    manager.status.workers = [...registeredWorkers];
    return [...registeredWorkers];
  }
  manager.status.workers = [];
  if (!handlers.deferWorkers) {
    startWorkers();
  }

  return {
    async startWorkers() {
      return startWorkers();
    },
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
