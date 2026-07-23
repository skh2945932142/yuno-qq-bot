import crypto from 'node:crypto';
import { config } from './config.js';
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

function looksLikeDeps(value) {
  return Boolean(value && (
    Array.isArray(value.tasks)
    || value.AutomationTask
  ));
}

function splitScopeAndDeps(scope = {}, deps = {}) {
  if (looksLikeDeps(scope) && (!deps || Object.keys(deps).length === 0)) {
    return { scope: {}, deps: scope };
  }

  return { scope: scope || {}, deps: deps || {} };
}

function applyOwnerScope(query, scope = {}) {
  if (scope.isAdmin) {
    return query;
  }

  const scopedQuery = { ...query };
  if (scope.chatId) scopedQuery.chatId = String(scope.chatId);
  if (scope.userId) scopedQuery.userId = String(scope.userId);
  return scopedQuery;
}

function taskMatchesOwnerScope(task, scope = {}) {
  if (scope.isAdmin) {
    return true;
  }
  if (scope.chatId && String(task.chatId) !== String(scope.chatId)) {
    return false;
  }
  if (scope.userId && String(task.userId) !== String(scope.userId)) {
    return false;
  }
  return true;
}

async function enforceActiveTaskQuota(task, maxActive, deps = {}) {
  const safeMax = Math.max(0, Number(maxActive || 0));
  if (safeMax <= 0 || !task.userId || !task.chatId) {
    return;
  }

  const matches = (item) => item.taskType === task.taskType
    && item.enabled !== false
    && String(item.chatId) === String(task.chatId)
    && String(item.userId) === String(task.userId);

  const activeCount = Array.isArray(deps.tasks)
    ? deps.tasks.filter(matches).length
    : await getTaskModel(deps).countDocuments({
        taskType: task.taskType,
        enabled: true,
        chatId: String(task.chatId),
        userId: String(task.userId),
      });

  if (activeCount >= safeMax) {
    throw new Error(`Active ${task.taskType} quota exceeded for this user`);
  }
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

  await enforceActiveTaskQuota(task, input.maxActivePerUser ?? config.maxActiveRemindersPerUser, deps);

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

export async function cancelReminderTask(taskId, scope = {}, maybeDeps = {}) {
  const { scope: resolvedScope, deps } = splitScopeAndDeps(scope, maybeDeps);

  if (Array.isArray(deps.tasks)) {
    const task = deps.tasks.find((item) => item.taskId === taskId
      && item.taskType === 'reminder'
      && taskMatchesOwnerScope(item, resolvedScope));
    if (!task) return null;
    task.enabled = false;
    task.updatedAt = new Date();
    return { ...task };
  }

  const model = getTaskModel(deps);
  const updated = await model.findOneAndUpdate(
    applyOwnerScope({ taskId: String(taskId || ''), taskType: 'reminder' }, resolvedScope),
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

  await enforceActiveTaskQuota(task, input.maxActivePerUser ?? config.maxActiveSubscriptionsPerUser, deps);

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

export async function cancelSubscriptionTask(taskId, scope = {}, maybeDeps = {}) {
  const { scope: resolvedScope, deps } = splitScopeAndDeps(scope, maybeDeps);

  if (Array.isArray(deps.tasks)) {
    const task = deps.tasks.find((item) => item.taskId === taskId
      && item.taskType === 'subscription'
      && taskMatchesOwnerScope(item, resolvedScope));
    if (!task) return null;
    task.enabled = false;
    task.updatedAt = new Date();
    return { ...task };
  }

  const model = getTaskModel(deps);
  const updated = await model.findOneAndUpdate(
    applyOwnerScope({ taskId: String(taskId || ''), taskType: 'subscription' }, resolvedScope),
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

export async function claimDueAutomationTasks(now = new Date(), claim = {}, deps = {}) {
  const current = asDate(now);
  const ownerId = String(claim.ownerId || `scheduler-${process.pid}`);
  const lockMs = Math.max(1000, Number(claim.lockMs || 120_000));
  const limit = Math.max(1, Number(claim.limit || config.automationTaskConcurrency || 3));
  const lockedUntil = new Date(current.getTime() + lockMs);

  if (Array.isArray(deps.tasks)) {
    const candidates = deps.tasks
      .filter((task) => task.enabled !== false
        && task.nextRunAt
        && asDate(task.nextRunAt).getTime() <= current.getTime()
        && (!task.lockedUntil || asDate(task.lockedUntil).getTime() <= current.getTime()))
      .sort((left, right) => asDate(left.nextRunAt).getTime() - asDate(right.nextRunAt).getTime())
      .slice(0, limit);

    return candidates.map((task) => {
      task.lockedBy = ownerId;
      task.lockedUntil = lockedUntil;
      task.deliveryAttempts = Number(task.deliveryAttempts || 0) + 1;
      task.lastDeliveryError = '';
      task.updatedAt = current;
      return { ...task };
    });
  }

  const model = getTaskModel(deps);
  const claimed = [];
  for (let index = 0; index < limit; index += 1) {
    const task = await model.findOneAndUpdate(
      {
        enabled: true,
        nextRunAt: { $lte: current },
        $or: [
          { lockedUntil: null },
          { lockedUntil: { $exists: false } },
          { lockedUntil: { $lte: current } },
        ],
      },
      {
        $set: {
          lockedBy: ownerId,
          lockedUntil,
          lastDeliveryError: '',
        },
        $inc: { deliveryAttempts: 1 },
      },
      {
        sort: { nextRunAt: 1 },
        returnDocument: 'after',
      }
    );
    if (!task) break;
    claimed.push(toTask(task));
  }
  return claimed;
}

export async function releaseAutomationTaskClaim(task, meta = {}, deps = {}) {
  const now = asDate(meta.now);
  const ownerId = String(meta.ownerId || task.lockedBy || '');
  const nextRunAt = meta.nextRunAt === undefined ? task.nextRunAt : meta.nextRunAt;
  const errorMessage = String(meta.error || '');

  if (Array.isArray(deps.tasks)) {
    const mutable = deps.tasks.find((item) => item.taskId === task.taskId
      && (!ownerId || String(item.lockedBy || '') === ownerId));
    if (!mutable) return null;
    mutable.lockedBy = '';
    mutable.lockedUntil = null;
    mutable.lastDeliveryError = errorMessage;
    mutable.nextRunAt = nextRunAt;
    mutable.updatedAt = now;
    return { ...mutable };
  }

  const model = getTaskModel(deps);
  const query = { taskId: task.taskId };
  if (ownerId) query.lockedBy = ownerId;
  const updated = await model.findOneAndUpdate(
    query,
    {
      $set: {
        lockedBy: '',
        lockedUntil: null,
        lastDeliveryError: errorMessage,
        nextRunAt,
      },
    },
    { returnDocument: 'after' }
  );
  return updated ? toTask(updated) : null;
}
export async function markAutomationTaskDelivered(task, meta = {}, deps = {}) {
  const now = asDate(meta.now);
  const deliveryKey = String(meta.deliveryKey || `${task.taskId}:${now.toISOString()}`);
  const nextRunAt = task.taskType === 'subscription' && Number(task.repeatIntervalMinutes || 0) > 0
    ? new Date(now.getTime() + (Number(task.repeatIntervalMinutes) * 60 * 1000))
    : null;
  const enabled = task.taskType === 'subscription';

  if (Array.isArray(deps.tasks)) {
    const mutable = deps.tasks.find((item) => item.taskId === task.taskId
      && (!meta.ownerId || String(item.lockedBy || '') === String(meta.ownerId)));
    if (!mutable) return null;
    mutable.lastTriggeredAt = now;
    mutable.lastDeliveredKey = deliveryKey;
    mutable.nextRunAt = nextRunAt;
    mutable.enabled = enabled;
    mutable.lockedBy = '';
    mutable.lockedUntil = null;
    mutable.lastDeliveryError = '';
    mutable.updatedAt = now;
    return { ...mutable };
  }

  const model = getTaskModel(deps);
  const query = { taskId: task.taskId };
  if (meta.ownerId) query.lockedBy = String(meta.ownerId);
  const updated = await model.findOneAndUpdate(
    query,
    {
      $set: {
        lastTriggeredAt: now,
        lastDeliveredKey: deliveryKey,
        nextRunAt,
        enabled,
        lockedBy: '',
        lockedUntil: null,
        lastDeliveryError: '',
      },
    },
    { returnDocument: 'after' }
  );
  return updated ? toTask(updated) : null;
}