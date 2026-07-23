import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueManager } from './src/queue-manager.js';

function createConfig() {
  return {
    enableQueue: true,
    redisUrl: 'redis://queue.invalid',
    replyQueueName: 'reply_job',
    persistQueueName: 'persist_job',
    queueRetryAttempts: 3,
    queueBackoffMs: 25,
    queueConcurrency: { default: 2, reply: 3, persist: 1 },
  };
}

function createBullFakes() {
  const queues = [];
  const workers = [];
  const metrics = [];
  const redis = {
    quitCalled: false,
    disconnectCalled: false,
    pingCalls: 0,
    listeners: new Map(),
    async ping() { this.pingCalls += 1; return 'PONG'; },
    on(event, handler) {
      this.listeners.set(event, handler);
      return this;
    },
    disconnect() { this.disconnectCalled = true; },
    async quit() { this.quitCalled = true; },
  };

  class FakeQueue {
    constructor(name, options) {
      this.name = name;
      this.options = options;
      this.addCalls = [];
      queues.push(this);
    }

    async add(name, data, options) {
      this.addCalls.push({ name, data, options });
      if (FakeQueue.addImpl) return FakeQueue.addImpl(name, data, options);
      return { id: options.jobId || `${name}:1`, data };
    }

    async close() {
      this.closed = true;
    }
  }

  class FakeWorker {
    constructor(name, processor, options) {
      this.name = name;
      this.processor = processor;
      this.options = options;
      this.listeners = new Map();
      workers.push(this);
    }

    on(event, handler) {
      this.listeners.set(event, handler);
      return this;
    }

    async close() {
      this.closed = true;
    }
  }

  return {
    queues,
    workers,
    metrics,
    redis,
    bullMq: { Queue: FakeQueue, Worker: FakeWorker },
    loadBullMq: async () => ({ Queue: FakeQueue, Worker: FakeWorker }),
    loadIORedis: async () => ({ default: class FakeRedis { constructor() { return redis; } } }),
    logger: { warn: (...args) => metrics.push(['warn', ...args]) },
    recordWorkflowMetric: (...args) => metrics.push(args),
  };
}

test('bull queue manager registers workers and forwards queue options', async () => {
  const fakes = createBullFakes();
  const handled = [];
  const manager = await createQueueManager(createConfig(), {
    replyJob: async (data, job) => handled.push(['reply', data, job]),
    persistJob: async (data, job) => handled.push(['persist', data, job]),
  }, fakes);

  assert.deepEqual(manager.getStatus(), {
    enabled: true,
    mode: 'bullmq',
    ready: true,
    provider: 'bullmq',
    workers: ['reply', 'persist'],
  });
  assert.equal(fakes.redis.pingCalls, 1);
  assert.equal(fakes.workers.length, 2);
  assert.deepEqual(fakes.workers.map((worker) => worker.options.concurrency), [3, 1]);

  const result = await manager.enqueueReply({ event: 'e1' }, { jobId: 'reply:1', attempts: 4, backoffDelayMs: 50 });
  assert.deepEqual(result, { id: 'reply:1', data: { event: 'e1' } });
  assert.deepEqual(fakes.queues[0].addCalls[0].options, {
    jobId: 'reply:1',
    attempts: 4,
    backoff: { type: 'exponential', delay: 50 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });

  await fakes.workers[0].processor({ data: { event: 'e2' }, id: 'bull-1', attemptsMade: 2 });
  assert.deepEqual(handled[0], ['reply', { event: 'e2' }, {
    id: 'bull-1', name: 'reply_job', queueName: 'reply_job', attemptsMade: 2, mode: 'bullmq',
  }]);
  await fakes.workers[0].listeners.get('completed')();
  await fakes.workers[0].listeners.get('failed')(null, new Error('failed'));
  assert.equal(fakes.metrics.some((entry) => entry[0] === 'yuno_queue_completed_total'), true);
  assert.equal(fakes.metrics.some((entry) => entry[0] === 'yuno_queue_failed_total'), true);

  await manager.close();
  assert.equal(fakes.workers.every((worker) => worker.closed), true);
  assert.equal(fakes.queues.every((queue) => queue.closed), true);
  assert.equal(fakes.redis.quitCalled, true);
});

test('bull queue readiness follows Redis connection events', async () => {
  const fakes = createBullFakes();
  const manager = await createQueueManager(createConfig(), {
    replyJob: async () => {}, persistJob: async () => {},
  }, fakes);

  fakes.redis.listeners.get('close')();
  assert.equal(manager.getStatus().ready, false);
  fakes.redis.listeners.get('ready')();
  assert.equal(manager.getStatus().ready, true);
});

test('bull queue manager maps duplicate job errors but rethrows other errors', async () => {
  const fakes = createBullFakes();
  const manager = await createQueueManager(createConfig(), { replyJob: async () => {}, persistJob: async () => {} }, fakes);
  await manager.enqueueReply({}, { jobId: 'reply:seed' });
  fakes.queues[0].add = async () => { throw new Error('Job is already waiting'); };
  assert.deepEqual(await manager.enqueueReply({}, { jobId: 'reply:duplicate' }), {
    id: 'reply:duplicate', deduplicated: true,
  });

  fakes.queues[0].add = async () => { throw new Error('redis unavailable'); };
  await assert.rejects(() => manager.enqueueReply({}, { jobId: 'reply:error' }), /redis unavailable/);
  await manager.close();
});

test('split runtime roles fail instead of executing queue work inline', async () => {
  const fakes = createBullFakes();
  fakes.redis.ping = async () => {
    throw new Error('redis unavailable for split role');
  };

  await assert.rejects(
    () => createQueueManager(createConfig(), {
      replyJob: async () => {},
      persistJob: async () => {},
      workers: { reply: false, persist: false },
    }, {
      ...fakes,
      allowInlineFallback: false,
    }),
    /redis unavailable for split role/
  );
  assert.equal(fakes.redis.disconnectCalled, true);
  assert.equal(fakes.workers.length, 0);
});

test('queue workers can be started after runtime services are registered', async () => {
  const fakes = createBullFakes();
  const manager = await createQueueManager(createConfig(), {
    replyJob: async () => {},
    persistJob: async () => {},
    deferWorkers: true,
  }, fakes);

  assert.equal(fakes.workers.length, 0);
  assert.deepEqual(manager.getStatus().workers, []);

  assert.deepEqual(await manager.startWorkers(), ['reply', 'persist']);
  assert.equal(fakes.workers.length, 2);
  assert.deepEqual(manager.getStatus().workers, ['reply', 'persist']);

  assert.deepEqual(await manager.startWorkers(), ['reply', 'persist']);
  assert.equal(fakes.workers.length, 2);
  await manager.close();
});

test('queue manager falls back to inline mode when BullMQ cannot initialize', async () => {
  const handled = [];
  const manager = await createQueueManager(createConfig(), {
    replyJob: async (data, job) => handled.push([data, job]),
    persistJob: async () => {},
  }, {
    loadBullMq: async () => { throw new Error('bullmq unavailable'); },
    loadIORedis: async () => ({ default: class {} }),
    recordWorkflowMetric: () => {},
    logger: { warn: () => {} },
    now: () => 10_000,
  });

  assert.equal(manager.getStatus().mode, 'inline');
  await manager.enqueueReply({ id: 'inline' }, { jobId: 'reply:inline' });
  assert.deepEqual(handled[0], [{ id: 'inline' }, {
    name: 'reply_job', id: 'reply:inline', queueName: 'reply_job', attemptsMade: 0, mode: 'inline',
  }]);
});

test('inline queue uses injected clock for deduplication expiry', async () => {
  let now = 1000;
  const handled = [];
  const manager = await createQueueManager({
    ...createConfig(),
    enableQueue: false,
    redisUrl: '',
  }, {
    replyJob: async (data) => handled.push(data),
    persistJob: async () => {},
  }, { now: () => now, recordWorkflowMetric: () => {} });

  await manager.enqueueReply({ id: 'first' }, { jobId: 'reply:same' });
  now += 5 * 60 * 1000 + 1;
  await manager.enqueueReply({ id: 'second' }, { jobId: 'reply:same' });
  assert.deepEqual(handled, [{ id: 'first' }, { id: 'second' }]);
});

test('queue manager probes Redis before advertising BullMQ readiness', async () => {
  const handled = [];
  const fakes = createBullFakes();
  fakes.redis.ping = async () => {
    fakes.redis.pingCalls += 1;
    throw new Error('redis connection refused');
  };

  const manager = await createQueueManager(createConfig(), {
    replyJob: async (data) => handled.push(data),
    persistJob: async () => {},
  }, fakes);

  assert.equal(fakes.redis.pingCalls, 1);
  assert.equal(fakes.redis.disconnectCalled, true);
  assert.deepEqual(manager.getStatus(), {
    enabled: false,
    mode: 'inline',
    ready: true,
    provider: 'inline',
    degraded: true,
    reason: 'redis connection refused',
    workers: [],
  });
  await manager.enqueueReply({ id: 'fallback' }, { jobId: 'reply:fallback' });
  assert.deepEqual(handled, [{ id: 'fallback' }]);
});

test('bull queue manager starts only the workers enabled for the runtime role', async () => {
  const fakes = createBullFakes();
  const manager = await createQueueManager(createConfig(), {
    replyJob: async () => {},
    persistJob: async () => {},
    workers: { reply: false, persist: true },
  }, fakes);

  assert.equal(fakes.workers.length, 1);
  assert.equal(fakes.workers[0].name, 'persist_job');
  assert.deepEqual(manager.getStatus().workers, ['persist']);

  await manager.enqueueReply({ event: 'producer-only' }, { jobId: 'reply:producer-only' });
  assert.equal(fakes.queues.some((queue) => queue.name === 'reply_job'), true);
  await manager.close();
});
