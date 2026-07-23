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

function createModel() {
  const calls = [];
  const model = {
    calls,
    async countDocuments(query) { calls.push(['countDocuments', query]); return 0; },
    async create(task) { calls.push(['create', task]); return { toObject: () => ({ ...task, modelCreated: true }) }; },
    find(query) {
      calls.push(['find', query]);
      return {
        sort(order) {
          calls.push(['sort', order]);
          return [{ taskId: 'listed', taskType: query.taskType, enabled: true, toObject: () => ({ taskId: 'listed' }) }];
        },
      };
    },
    async findOneAndUpdate(query, update, options) {
      calls.push(['findOneAndUpdate', query, update, options]);
      return { toObject: () => ({ taskId: query.taskId, enabled: update.$set?.enabled ?? true, nextRunAt: update.$set?.nextRunAt }) };
    },
  };
  return model;
}

test('automation tasks cover model-backed create, list, cancel, due, and delivery paths', async () => {
  const model = createModel();
  const deps = { AutomationTask: model };
  const now = new Date('2026-07-23T10:00:00Z');

  const reminder = await createReminderTask({ userId: 'u1', chatId: 'c1', delayMinutes: 2, text: 'water', now }, deps);
  assert.equal(reminder.modelCreated, true);
  assert.equal((await listReminderTasks({ chatId: 'c1', userId: 'u1' }, deps))[0].taskId, 'listed');
  assert.equal((await cancelReminderTask('r1', { chatId: 'c1', userId: 'u1' }, deps)).enabled, false);

  const subscription = await createSubscriptionTask({
    userId: 'u1', chatId: 'c1', intervalMinutes: 10, sourceType: 'keyword', target: 'deploy', now,
  }, deps);
  assert.equal(subscription.modelCreated, true);
  assert.equal((await listSubscriptionTasks({ chatId: 'c1', userId: 'u1' }, deps))[0].taskId, 'listed');
  assert.equal((await cancelSubscriptionTask('s1', { chatId: 'c1', userId: 'u1' }, deps)).enabled, false);

  const due = await getDueAutomationTasks(now, deps);
  assert.equal(due[0].taskId, 'listed');
  assert.equal((await markAutomationTaskDelivered({ taskId: 's1', taskType: 'subscription', repeatIntervalMinutes: 10 }, { now, deliveryKey: 'k1' }, deps)).taskId, 's1');
  assert.equal(model.calls.filter((entry) => entry[0] === 'findOneAndUpdate').length, 3);
});

test('automation task model paths return null for absent updates and support admin scope', async () => {
  const model = createModel();
  model.findOneAndUpdate = async () => null;
  const deps = { AutomationTask: model };
  assert.equal(await cancelReminderTask('missing', { isAdmin: true }, deps), null);
  assert.equal(await cancelSubscriptionTask('missing', { isAdmin: true }, deps), null);
  assert.equal(await markAutomationTaskDelivered({ taskId: 'missing', taskType: 'reminder' }, {}, deps), null);
});
