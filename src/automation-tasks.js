import crypto from 'node:crypto';
import { AutomationTask } from './models.js';

function buildTaskId() {
  return crypto.randomUUID();
}

function asDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function getTaskModel(deps = {}) {
  return deps.AutomationTask || AutomationTask;
}

function toTask(task) {
  return typeof task?.toObject === 'function' ? task.toObject() : task;
}

function filterTasks(tasks, predicate) {
  return tasks.filter(predicate).map((task) => ({ ...task }));
}

export async function createReminderTask(input, deps = {}) {
  const now = asDate(input.now);
  const delayMinutes = Math.max(1, Number(input.delayMinutes || 0));
  const task = {
    taskId: input.taskId || buildTaskId(),
    platform: input.platform || 'qq',
    chatType: input.chatType || 'private',
    chatId: String(input.chatId || input.groupId || input.userId || ''),
    groupId: String(input.groupId || (input.chatType === 'group' ? input.chatId || '' : '')),
    userId: String(input.userId || ''),
    taskType: 'reminder',
    enabled: true,
    triggerAt: new Date(now.getTime() + (delayMinutes * 60 * 1000)),
    nextRunAt: new Date(now.getTime() + (delayMinutes * 60 * 1000)),
    repeatIntervalMinutes: 0,
    sourceType: input.sourceType || 'manual',
    target: String(input.target || input.userId || ''),
    summary: String(input.text || '').trim(),
    payload: {
      text: String(input.text || '').trim(),
      delayMinutes,
    },
  };

  if (Array.isArray(deps.tasks)) {
    deps.tasks.push({ ...task, createdAt: now, updatedAt: now });
    return { ...deps.tasks[deps.tasks.length - 1] };
  }

  const model = getTaskModel(deps);
  const created = await model.create(task);
  return toTask(created);
}

export async function listReminderTasks(scope = {}, deps = {}) {
  if (Array.isArray(deps.tasks)) {
    return filterTasks(deps.tasks, (task) => task.taskType === 'reminder'
      && task.enabled !== false
      && (!scope.chatId || String(task.chatId) === String(scope.chatId))
      && (!scope.userId || String(task.userId) === String(scope.userId)));
  }

  const model = getTaskModel(deps);
  const query = { taskType: 'reminder', enabled: true };
  if (scope.chatId) query.chatId = String(scope.chatId);
  if (scope.userId) query.userId = String(scope.userId);
  const results = await model.find(query).sort({ nextRunAt: 1 });
  return results.map(toTask);
}

export async function cancelReminderTask(taskId, deps = {}) {
  if (Array.isArray(deps.tasks)) {
    const task = deps.tasks.find((item) => item.taskId === taskId && item.taskType === 'reminder');
    if (!task) return null;
    task.enabled = false;
    task.updatedAt = new Date();
    return { ...task };
  }

  const model = getTaskModel(deps);
  const updated = await model.findOneAndUpdate(
    { taskId: String(taskId || ''), taskType: 'reminder' },
    { $set: { enabled: false } },
    { returnDocument: 'after' }
  );
  return updated ? toTask(updated) : null;
}

export async function createSubscriptionTask(input, deps = {}) {
  const now = asDate(input.now);
  const intervalMinutes = Math.max(5, Number(input.intervalMinutes || 0));
  const task = {
    taskId: input.taskId || buildTaskId(),
    platform: input.platform || 'qq',
    chatType: input.chatType || 'private',
    chatId: String(input.chatId || input.groupId || input.userId || ''),
    groupId: String(input.groupId || (input.chatType === 'group' ? input.chatId || '' : '')),
    userId: String(input.userId || ''),
    taskType: 'subscription',
    enabled: true,
    triggerAt: null,
    nextRunAt: new Date(now.getTime() + (intervalMinutes * 60 * 1000)),
    repeatIntervalMinutes: intervalMinutes,
    sourceType: String(input.sourceType || 'manual'),
    target: String(input.target || ''),
    summary: String(input.summary || input.target || '').trim(),
    payload: {
      sourceType: String(input.sourceType || 'manual'),
      target: String(input.target || ''),
      summary: String(input.summary || '').trim(),
    },
  };

  if (Array.isArray(deps.tasks)) {
    deps.tasks.push({ ...task, createdAt: now, updatedAt: now });
    return { ...deps.tasks[deps.tasks.length - 1] };
  }

  const model = getTaskModel(deps);
  const created = await model.create(task);
  return toTask(created);
}

export async function listSubscriptionTasks(scope = {}, deps = {}) {
  if (Array.isArray(deps.tasks)) {
    return filterTasks(deps.tasks, (task) => task.taskType === 'subscription'
      && task.enabled !== false
      && (!scope.chatId || String(task.chatId) === String(scope.chatId))
      && (!scope.userId || String(task.userId) === String(scope.userId)));
  }

  const model = getTaskModel(deps);
  const query = { taskType: 'subscription', enabled: true };
  if (scope.chatId) query.chatId = String(scope.chatId);
  if (scope.userId) query.userId = String(scope.userId);
  const results = await model.find(query).sort({ nextRunAt: 1 });
  return results.map(toTask);
}

export async function cancelSubscriptionTask(taskId, deps = {}) {
  if (Array.isArray(deps.tasks)) {
    const task = deps.tasks.find((item) => item.taskId === taskId && item.taskType === 'subscription');
    if (!task) return null;
    task.enabled = false;
    task.updatedAt = new Date();
    return { ...task };
  }

  const model = getTaskModel(deps);
  const updated = await model.findOneAndUpdate(
    { taskId: String(taskId || ''), taskType: 'subscription' },
    { $set: { enabled: false } },
    { returnDocument: 'after' }
  );
  return updated ? toTask(updated) : null;
}

export async function getDueAutomationTasks(now = new Date(), deps = {}) {
  const current = asDate(now);

  if (Array.isArray(deps.tasks)) {
    return filterTasks(deps.tasks, (task) => task.enabled !== false && task.nextRunAt && asDate(task.nextRunAt).getTime() <= current.getTime());
  }

  const model = getTaskModel(deps);
  const results = await model.find({
    enabled: true,
    nextRunAt: { $lte: current },
  }).sort({ nextRunAt: 1 });
  return results.map(toTask);
}

export async function markAutomationTaskDelivered(task, meta = {}, deps = {}) {
  const now = asDate(meta.now);
  const deliveryKey = String(meta.deliveryKey || `${task.taskId}:${now.toISOString()}`);
  const nextRunAt = task.taskType === 'subscription' && Number(task.repeatIntervalMinutes || 0) > 0
    ? new Date(now.getTime() + (Number(task.repeatIntervalMinutes) * 60 * 1000))
    : null;
  const enabled = task.taskType === 'subscription';

  if (Array.isArray(deps.tasks)) {
    const mutable = deps.tasks.find((item) => item.taskId === task.taskId);
    if (!mutable) return null;
    mutable.lastTriggeredAt = now;
    mutable.lastDeliveredKey = deliveryKey;
    mutable.nextRunAt = nextRunAt;
    mutable.enabled = enabled;
    mutable.updatedAt = now;
    return { ...mutable };
  }

  const model = getTaskModel(deps);
  const updated = await model.findOneAndUpdate(
    { taskId: task.taskId },
    {
      $set: {
        lastTriggeredAt: now,
        lastDeliveredKey: deliveryKey,
        nextRunAt,
        enabled,
      },
    },
    { returnDocument: 'after' }
  );
  return updated ? toTask(updated) : null;
}
