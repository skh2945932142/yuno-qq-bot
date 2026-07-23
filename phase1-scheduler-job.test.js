import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runDueAutomationTasks,
  runSingleAutomationTask,
} from './src/jobs/scheduler-job.js';

function createTask(overrides = {}) {
  return {
    taskId: 'task-1',
    platform: 'qq',
    chatType: 'private',
    chatId: 'user-1',
    userId: 'user-1',
    taskType: 'reminder',
    summary: 'stand up',
    nextRunAt: new Date('2026-07-23T11:59:00Z'),
    ...overrides,
  };
}

test('scheduler delivers with a stable occurrence key before marking the task delivered', async () => {
  const calls = [];
  const now = new Date('2026-07-23T12:00:00Z');
  const task = createTask();

  const result = await runSingleAutomationTask(task, now, {
    ownerId: 'scheduler-a',
    deliverSchedulerToolResult: async (_task, _toolResult, options) => {
      calls.push(['deliver', options.deliveryKey]);
      return { delivery: { status: 'sent', deduplicated: false } };
    },
    markAutomationTaskDelivered: async (_task, meta) => {
      calls.push(['mark', meta.deliveryKey]);
    },
  });

  const expectedKey = 'scheduler:task-1:2026-07-23T11:59:00.000Z';
  assert.deepEqual(calls, [
    ['deliver', expectedKey],
    ['mark', expectedKey],
  ]);
  assert.equal(result.deliveryKey, expectedKey);
  assert.equal(result.skipped, false);
});

test('scheduler releases a claimed group task before deferring it for quiet hours', async () => {
  const releases = [];
  const now = new Date('2026-07-23T12:00:00Z');
  const task = createTask({ chatType: 'group', chatId: 'group-1', groupId: 'group-1' });

  const result = await runSingleAutomationTask(task, now, {
    ownerId: 'scheduler-a',
    listGroupRules: async () => [],
    isWithinQuietHours: () => true,
    releaseAutomationTaskClaim: async (_task, meta) => releases.push(meta),
    deliverSchedulerToolResult: async () => {
      throw new Error('quiet-hours task must not deliver');
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'quiet-hours');
  assert.equal(releases.length, 1);
  assert.equal(releases[0].ownerId, 'scheduler-a');
  assert.equal(releases[0].error, 'quiet-hours');
  assert.equal(releases[0].nextRunAt.toISOString(), '2026-07-23T12:05:00.000Z');
});

test('scheduler releases its task claim when delivery is already in progress', async () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const task = createTask();
  const releases = [];
  let markCalls = 0;

  const results = await runDueAutomationTasks(now, {
    ownerId: 'scheduler-b',
    concurrency: 1,
    claimDueAutomationTasks: async () => [task],
    releaseAutomationTaskClaim: async (_task, meta) => releases.push(meta),
    deliverSchedulerToolResult: async () => ({
      delivery: { status: 'sending', deduplicated: true },
    }),
    markAutomationTaskDelivered: async () => {
      markCalls += 1;
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].error.code, 'DELIVERY_IN_PROGRESS');
  assert.equal(markCalls, 0);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].ownerId, 'scheduler-b');
  assert.match(releases[0].error, /already in progress/);
});
