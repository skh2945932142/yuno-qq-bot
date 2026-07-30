import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScheduler,
  runDueAutomationTasks,
  runSingleAutomationTask,
} from './src/jobs/scheduler-job.js';
import { planScheduledInteraction } from './src/state/group-state-runtime.js';

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

function schedulerConfig(overrides = {}) {
  return {
    targetGroupId: '20001',
    dailyMoodTimezone: 'Asia/Shanghai',
    proactiveMessagesEnabled: false,
    ...overrides,
  };
}

test('scheduler skips the proactive cron slots when proactive messages are disabled', () => {
  const disabled = createScheduler({ config: schedulerConfig() });
  disabled.start();
  const disabledCount = disabled.taskCount;
  disabled.stop();

  const enabled = createScheduler({ config: schedulerConfig({ proactiveMessagesEnabled: true }) });
  enabled.start();
  const enabledCount = enabled.taskCount;
  enabled.stop();

  assert.equal(enabledCount - disabledCount, 2);
});

test('planScheduledInteraction refuses to speak first when proactive messages are disabled', () => {
  const now = new Date('2026-03-13T07:00:00+08:00');
  const groupState = {
    mood: 'CALM',
    activityLevel: 25,
    lastMessageAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    lastProactiveAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
    recentTopics: ['morning-class'],
  };

  const blocked = planScheduledInteraction({
    groupState,
    recentEvents: [],
    dateContext: now,
    runtimeConfig: { proactiveMessagesEnabled: false, dailyMoodTimezone: 'Asia/Shanghai' },
  });
  assert.equal(blocked.shouldSend, false);
  assert.equal(blocked.reason, 'proactive-disabled');

  const allowed = planScheduledInteraction({
    groupState,
    recentEvents: [],
    dateContext: now,
    runtimeConfig: { proactiveMessagesEnabled: true, dailyMoodTimezone: 'Asia/Shanghai' },
  });
  assert.equal(allowed.shouldSend, true);
});
