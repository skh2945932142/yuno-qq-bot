import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelReminderTask,
  cancelSubscriptionTask,
  claimDueAutomationTasks,
  createReminderTask,
  createSubscriptionTask,
  getDueAutomationTasks,
  listReminderTasks,
  listSubscriptionTasks,
  markAutomationTaskDelivered,
  releaseAutomationTaskClaim,
} from './src/automation-tasks.js';

test('reminder tasks can be created, listed, and cancelled', async () => {
  const tasks = [];
  const created = await createReminderTask({
    userId: 'u1',
    chatId: 'u1',
    chatType: 'private',
    delayMinutes: 15,
    text: 'drink water',
    now: new Date('2026-03-27T12:00:00+08:00'),
  }, { tasks });

  const listed = await listReminderTasks({ userId: 'u1', chatId: 'u1' }, { tasks });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].summary, 'drink water');

  const cancelled = await cancelReminderTask(created.taskId, { tasks });
  assert.equal(cancelled.enabled, false);
});

test('reminder cancellation is scoped to owner unless caller is admin', async () => {
  const tasks = [];
  const created = await createReminderTask({
    userId: 'u1',
    chatId: 'group-1',
    groupId: 'group-1',
    chatType: 'group',
    delayMinutes: 15,
    text: 'standup',
    now: new Date('2026-03-27T12:00:00+08:00'),
  }, { tasks });

  const denied = await cancelReminderTask(created.taskId, {
    chatId: 'group-1',
    userId: 'u2',
  }, { tasks });
  assert.equal(denied, null);
  assert.equal(tasks[0].enabled, true);

  const adminCancelled = await cancelReminderTask(created.taskId, {
    chatId: 'group-1',
    userId: 'admin',
    isAdmin: true,
  }, { tasks });
  assert.equal(adminCancelled.enabled, false);
});

test('reminder creation enforces active task quota per chat and user', async () => {
  const tasks = [];
  await createReminderTask({
    userId: 'u1',
    chatId: 'u1',
    chatType: 'private',
    delayMinutes: 15,
    text: 'one',
    maxActivePerUser: 1,
    now: new Date('2026-03-27T12:00:00+08:00'),
  }, { tasks });

  await assert.rejects(
    () => createReminderTask({
      userId: 'u1',
      chatId: 'u1',
      chatType: 'private',
      delayMinutes: 20,
      text: 'two',
      maxActivePerUser: 1,
      now: new Date('2026-03-27T12:01:00+08:00'),
    }, { tasks }),
    /quota/i
  );
});

test('subscription tasks can cycle through due delivery', async () => {
  const tasks = [];
  const created = await createSubscriptionTask({
    userId: 'u1',
    chatId: 'u1',
    chatType: 'private',
    sourceType: 'keyword',
    target: 'deploy',
    intervalMinutes: 10,
    summary: 'watch deploy',
    now: new Date('2026-03-27T12:00:00+08:00'),
  }, { tasks });

  const listed = await listSubscriptionTasks({ userId: 'u1', chatId: 'u1' }, { tasks });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].target, 'deploy');

  const due = await getDueAutomationTasks(new Date('2026-03-27T12:15:00+08:00'), { tasks });
  assert.equal(due.length, 1);
  assert.equal(due[0].taskId, created.taskId);

  const delivered = await markAutomationTaskDelivered(due[0], {
    now: new Date('2026-03-27T12:15:00+08:00'),
    deliveryKey: 'tick-1',
  }, { tasks });
  assert.equal(delivered.enabled, true);
  assert.ok(new Date(delivered.nextRunAt).getTime() > new Date('2026-03-27T12:15:00+08:00').getTime());

  const cancelled = await cancelSubscriptionTask(created.taskId, { tasks });
  assert.equal(cancelled.enabled, false);
});

test('subscription cancellation is scoped to owner unless caller is admin', async () => {
  const tasks = [];
  const created = await createSubscriptionTask({
    userId: 'u1',
    chatId: 'group-1',
    groupId: 'group-1',
    chatType: 'group',
    sourceType: 'keyword',
    target: 'deploy',
    intervalMinutes: 10,
    summary: 'watch deploy',
    now: new Date('2026-03-27T12:00:00+08:00'),
  }, { tasks });

  const denied = await cancelSubscriptionTask(created.taskId, {
    chatId: 'group-1',
    userId: 'u2',
  }, { tasks });
  assert.equal(denied, null);
  assert.equal(tasks[0].enabled, true);

  const adminCancelled = await cancelSubscriptionTask(created.taskId, {
    userId: 'admin',
    isAdmin: true,
  }, { tasks });
  assert.equal(adminCancelled.enabled, false);
});

test('subscription creation enforces active task quota per chat and user', async () => {
  const tasks = [];
  await createSubscriptionTask({
    userId: 'u1',
    chatId: 'u1',
    chatType: 'private',
    sourceType: 'keyword',
    target: 'deploy',
    intervalMinutes: 10,
    summary: 'watch deploy',
    maxActivePerUser: 1,
    now: new Date('2026-03-27T12:00:00+08:00'),
  }, { tasks });

  await assert.rejects(
    () => createSubscriptionTask({
      userId: 'u1',
      chatId: 'u1',
      chatType: 'private',
      sourceType: 'keyword',
      target: 'release',
      intervalMinutes: 10,
      summary: 'watch release',
      maxActivePerUser: 1,
      now: new Date('2026-03-27T12:01:00+08:00'),
    }, { tasks }),
    /quota/i
  );
});

test('due automation tasks are claimed once across competing scheduler instances', async () => {
  const now = new Date('2026-07-23T12:00:00+08:00');
  const tasks = [{
    taskId: 'due-1',
    platform: 'qq',
    chatType: 'private',
    chatId: 'user-1',
    userId: 'user-1',
    taskType: 'reminder',
    enabled: true,
    nextRunAt: new Date(now.getTime() - 1000),
  }];

  const first = await claimDueAutomationTasks(now, {
    ownerId: 'scheduler-a',
    lockMs: 60_000,
    limit: 1,
  }, { tasks });
  const competing = await claimDueAutomationTasks(now, {
    ownerId: 'scheduler-b',
    lockMs: 60_000,
    limit: 1,
  }, { tasks });

  assert.equal(first.length, 1);
  assert.equal(first[0].lockedBy, 'scheduler-a');
  assert.equal(competing.length, 0);

  await releaseAutomationTaskClaim(first[0], {
    ownerId: 'scheduler-a',
    now,
    nextRunAt: first[0].nextRunAt,
    error: 'retry',
  }, { tasks });

  const reclaimed = await claimDueAutomationTasks(now, {
    ownerId: 'scheduler-b',
    lockMs: 60_000,
    limit: 1,
  }, { tasks });

  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].lockedBy, 'scheduler-b');
  assert.equal(reclaimed[0].deliveryAttempts, 2);
});
