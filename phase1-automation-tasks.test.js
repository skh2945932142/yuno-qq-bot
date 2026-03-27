import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelReminderTask,
  cancelSubscriptionTask,
  createReminderTask,
  createSubscriptionTask,
  getDueAutomationTasks,
  listReminderTasks,
  listSubscriptionTasks,
  markAutomationTaskDelivered,
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
