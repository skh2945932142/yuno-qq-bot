import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { chat } from '../minimax.js';
import { sendText } from '../sender.js';
import {
  cleanupGroupEventsRetention,
  ensureGroupState,
  getRecentEvents,
  logSchedulerSkip,
  markProactiveSent,
  planScheduledInteraction,
} from '../state/group-state-runtime.js';
import { buildScheduledPrompt } from '../prompt-builder.js';
import { createTraceContext, failTrace, finalizeTrace, withTraceSpan } from '../runtime-tracing.js';
import { buildDailyDigest } from '../group-ops.js';
import {
  claimDueAutomationTasks,
  markAutomationTaskDelivered,
  releaseAutomationTaskClaim,
} from '../automation-tasks.js';
import { isWithinQuietHours, listGroupRules } from '../group-automation.js';
import { runYunoConversation } from '../yuno-core.js';
import { recordWorkflowMetric } from '../metrics.js';

const SCHEDULER_INSTANCE_ID = process.env.YUNO_SCHEDULER_INSTANCE_ID
  || process.env.HOSTNAME || `scheduler-${process.pid}`;

function buildSchedulerToolResult(task) {
  return task.taskType === 'reminder'
    ? {
        tool: 'reminder_due',
        payload: {
          taskId: task.taskId,
          text: task.payload?.text || task.summary,
          summary: task.summary,
        },
        summary: task.summary,
        priority: 'normal',
        visibility: task.chatType === 'group' ? 'group' : 'default',
        followUpHint: '',
        safetyFlags: [],
      }
    : {
        tool: 'subscription_update',
        payload: {
          taskId: task.taskId,
          sourceType: task.sourceType,
          target: task.target,
          summary: task.summary || `订阅 ${task.sourceType}:${task.target} 有了新的动静。`,
          actionSuggestion: task.payload?.actionSuggestion || '',
        },
        summary: task.summary || `订阅 ${task.sourceType}:${task.target} 有了新的动静。`,
        priority: 'low',
        visibility: task.chatType === 'group' ? 'group' : 'default',
        followUpHint: '',
        safetyFlags: [],
      };
}

export async function runSingleAutomationTask(task, now, options = {}) {
  const listRules = options.listGroupRules || listGroupRules;
  const withinQuietHours = options.isWithinQuietHours || isWithinQuietHours;
  const releaseClaim = options.releaseAutomationTaskClaim || releaseAutomationTaskClaim;
  const deliver = options.deliverSchedulerToolResult || deliverSchedulerToolResult;
  const markDelivered = options.markAutomationTaskDelivered || markAutomationTaskDelivered;
  const groupId = task.groupId || (task.chatType === 'group' ? task.chatId : '');
  if (groupId) {
    const rules = await listRules(groupId, { enabled: true });
    if (withinQuietHours(groupId, now, rules)) {
      recordWorkflowMetric('yuno_automation_tasks_deferred_total', 1, {
        task_type: task.taskType,
        reason: 'quiet-hours',
      });
      await releaseClaim(task, {
        ownerId: options.ownerId,
        now,
        nextRunAt: new Date(now.getTime() + 5 * 60 * 1000),
        error: 'quiet-hours',
      });
      return { taskId: task.taskId, skipped: true, reason: 'quiet-hours' };
    }
  }

  const nextRunAt = task.nextRunAt ? new Date(task.nextRunAt).getTime() : now.getTime();
  const delayMs = Math.max(0, now.getTime() - nextRunAt);
  recordWorkflowMetric('yuno_scheduler_task_delay_ms', delayMs, {
    task_type: task.taskType,
  }, 'histogram');

  const toolResult = buildSchedulerToolResult(task);
  const deliveryKey = `scheduler:${task.taskId}:${new Date(task.nextRunAt || now).toISOString()}`;
  const deliveryResult = await deliver(task, toolResult, { deliveryKey });
  if (deliveryResult?.delivery?.status === 'sending') {
    const error = new Error(`Delivery is already in progress: ${deliveryKey}`);
    error.code = 'DELIVERY_IN_PROGRESS';
    throw error;
  }
  await markDelivered(task, {
    now,
    ownerId: options.ownerId,
    deliveryKey,
  });

  recordWorkflowMetric('yuno_automation_tasks_triggered_total', 1, {
    task_type: task.taskType,
    chat_type: task.chatType,
  });
  return {
    taskId: task.taskId,
    skipped: false,
    deliveryKey,
    deduplicated: Boolean(deliveryResult?.delivery?.deduplicated),
  };
}

async function runWithConcurrency(tasks, concurrency, worker) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const safeConcurrency = Math.max(1, Number(concurrency || 1));
  const results = new Array(tasks.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) break;

      try {
        results[index] = await worker(tasks[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(safeConcurrency, tasks.length) }, () => runner()));
  return results;
}

export async function runScheduledInteraction(groupId) {
  const trace = createTraceContext('scheduled-interaction', { groupId: String(groupId) });

  try {
    const [groupState, recentEvents] = await withTraceSpan(trace, 'load-group-state', () => Promise.all([
      ensureGroupState(groupId),
      getRecentEvents(groupId, 3),
    ]));
    const plan = planScheduledInteraction({
      groupState,
      recentEvents,
      dateContext: new Date(),
    });

    if (!plan.shouldSend) {
      logSchedulerSkip(plan.reason);
      finalizeTrace(trace, {
        shouldSend: false,
        reason: plan.reason,
      });
      return;
    }

    const text = await withTraceSpan(trace, 'generate-message', () => chat(
      [],
      buildScheduledPrompt({ groupState, recentEvents, plan }),
      'Send one proactive message that matches the current group atmosphere.',
      {
        traceContext: trace,
        promptVersion: 'scheduled-message/v1',
        operation: 'scheduled-reply',
      }
    ));

    await withTraceSpan(trace, 'send-message', () => sendText(groupId, text));
    await withTraceSpan(trace, 'mark-proactive', () => markProactiveSent(groupId));

    logger.info('scheduler', 'Proactive group message sent', {
      groupId,
      topic: plan.topic,
      tone: plan.tone,
      traceId: trace.traceId,
    });
    finalizeTrace(trace, {
      shouldSend: true,
      topic: plan.topic,
      tone: plan.tone,
    });
  } catch (error) {
    failTrace(trace, error);
    logger.error('scheduler', 'Scheduled interaction failed', {
      message: error.message,
      traceId: trace.traceId,
    });
  }
}

async function deliverSchedulerToolResult(taskLike, toolResult, options = {}) {
  return runYunoConversation({
    platform: taskLike.platform || 'qq',
    scene: taskLike.chatType || 'group',
    userId: taskLike.userId || config.adminQq || 'system',
    groupId: taskLike.groupId || (taskLike.chatType === 'group' ? taskLike.chatId : ''),
    chatId: taskLike.chatId,
    username: taskLike.userName || 'Scheduler',
    rawMessage: taskLike.summary || toolResult.summary || '',
    metadata: {
      messageId: taskLike.taskId || '',
      timestamp: Date.now(),
      source: { adapter: 'scheduler' },
    },
  }, {
    toolResult,
    responseMode: 'send',
    deliveryKey: options.deliveryKey,
  });
}

export async function runDailyGroupDigest(groupId, now = new Date()) {
  const digest = await buildDailyDigest(groupId, { now, windowHours: 24 });
  const toolResult = {
    tool: 'group_daily_digest',
    payload: digest,
    summary: digest.summary,
    priority: 'normal',
    visibility: 'group',
    followUpHint: '',
    safetyFlags: [],
  };

  const deliveryKey = `scheduler:digest:${groupId}:${now.toISOString().slice(0, 10)}`;
  const deliveryResult = await deliverSchedulerToolResult({
    platform: 'qq',
    chatType: 'group',
    chatId: String(groupId),
    groupId: String(groupId),
    userId: config.adminQq || 'scheduler',
    taskId: `digest:${groupId}`,
    summary: digest.summary,
  }, toolResult, { deliveryKey });
  if (deliveryResult?.delivery?.status === 'sending') {
    const error = new Error(`Delivery is already in progress: ${deliveryKey}`);
    error.code = 'DELIVERY_IN_PROGRESS';
    throw error;
  }

  recordWorkflowMetric('yuno_group_reports_generated_total', 1, {
    group_id: String(groupId),
    source: 'daily-digest',
  });
}

export async function runDueAutomationTasks(now = new Date(), options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency || config.automationTaskConcurrency || 3));
  const ownerId = options.ownerId || SCHEDULER_INSTANCE_ID;
  const claimTasks = options.claimDueAutomationTasks || claimDueAutomationTasks;
  const releaseClaim = options.releaseAutomationTaskClaim || releaseAutomationTaskClaim;
  const dueTasks = await claimTasks(now, {
    ownerId,
    lockMs: Math.max(30_000, Number(config.schedulerTaskLockMs || 120_000)),
    limit: concurrency * 2,
  });
  const results = await runWithConcurrency(dueTasks, concurrency, (task) => runSingleAutomationTask(task, now, {
    ...options,
    ownerId,
  }));

  for (const [index, result] of results.entries()) {
    if (!result?.error) continue;
    const task = dueTasks[index];
    await releaseClaim(task, {
      ownerId,
      now,
      nextRunAt: task.nextRunAt,
      error: result.error.message,
    }).catch(() => {});
    logger.error('scheduler', 'Automation task execution failed', {
      taskId: task?.taskId,
      taskType: task?.taskType,
      chatType: task?.chatType,
      message: result.error.message,
    });
  }
  return results;
}
export function startScheduler() {
  const hasTargetGroup = Boolean(config.targetGroupId);

  cron.schedule('* * * * *', () => {
    runDueAutomationTasks(new Date()).catch((error) => {
      logger.error('scheduler', 'Automation task tick failed', {
        message: error.message,
      });
    });
  }, { timezone: 'Asia/Shanghai' });

  cron.schedule('*/10 * * * *', () => {
    cleanupGroupEventsRetention().catch((error) => {
      logger.warn('scheduler', 'Group event cleanup failed', {
        message: error.message,
      });
    });
  }, { timezone: 'Asia/Shanghai' });

  if (hasTargetGroup) {
    const trigger = () => {
      runScheduledInteraction(config.targetGroupId).catch((error) => {
        logger.error('scheduler', 'Scheduled interaction tick failed', {
          message: error.message,
        });
      });
    };

    cron.schedule('0 7 * * *', trigger, { timezone: 'Asia/Shanghai' });
    cron.schedule('0 23 * * *', trigger, { timezone: 'Asia/Shanghai' });
    cron.schedule('0 21 * * *', () => {
      runDailyGroupDigest(config.targetGroupId).catch((error) => {
        logger.error('scheduler', 'Daily digest failed', {
          message: error.message,
        });
      });
    }, { timezone: 'Asia/Shanghai' });
  }

  logger.info('scheduler', 'Scheduler started', {
    groupId: config.targetGroupId || '',
    hasTargetGroup,
  });
}

