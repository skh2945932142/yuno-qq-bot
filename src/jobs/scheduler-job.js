import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { chat } from '../minimax.js';
import { sendText } from '../sender.js';
import {
  ensureGroupState,
  getRecentEvents,
  logSchedulerSkip,
  markProactiveSent,
  planScheduledInteraction,
} from '../state/group-state.js';
import { buildScheduledPrompt } from '../prompt-builder.js';
import { createTraceContext, failTrace, finalizeTrace, withTraceSpan } from '../runtime-tracing.js';
import { buildDailyDigest } from '../group-ops.js';
import { getDueAutomationTasks, markAutomationTaskDelivered } from '../automation-tasks.js';
import { isWithinQuietHours, listGroupRules } from '../group-automation.js';
import { runYunoConversation } from '../yuno-core.js';
import { recordWorkflowMetric } from '../metrics.js';

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

async function deliverSchedulerToolResult(taskLike, toolResult) {
  await runYunoConversation({
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

  await deliverSchedulerToolResult({
    platform: 'qq',
    chatType: 'group',
    chatId: String(groupId),
    groupId: String(groupId),
    userId: config.adminQq || 'scheduler',
    taskId: `digest:${groupId}`,
    summary: digest.summary,
  }, toolResult);

  recordWorkflowMetric('yuno_group_reports_generated_total', 1, {
    group_id: String(groupId),
    source: 'daily-digest',
  });
}

export async function runDueAutomationTasks(now = new Date()) {
  const dueTasks = await getDueAutomationTasks(now);

  for (const task of dueTasks) {
    const groupId = task.groupId || (task.chatType === 'group' ? task.chatId : '');
    if (groupId) {
      const rules = await listGroupRules(groupId, { enabled: true });
      if (isWithinQuietHours(groupId, now, rules)) {
        recordWorkflowMetric('yuno_automation_tasks_deferred_total', 1, {
          task_type: task.taskType,
          reason: 'quiet-hours',
        });
        continue;
      }
    }

    const toolResult = task.taskType === 'reminder'
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
            summary: task.summary || `Subscription matched for ${task.sourceType}:${task.target}.`,
            actionSuggestion: task.payload?.actionSuggestion || '',
          },
          summary: task.summary || `Subscription matched for ${task.sourceType}:${task.target}.`,
          priority: 'low',
          visibility: task.chatType === 'group' ? 'group' : 'default',
          followUpHint: '',
          safetyFlags: [],
        };

    await deliverSchedulerToolResult(task, toolResult);
    await markAutomationTaskDelivered(task, {
      now,
      deliveryKey: `scheduler:${task.taskId}:${new Date(now).toISOString()}`,
    });

    recordWorkflowMetric('yuno_automation_tasks_triggered_total', 1, {
      task_type: task.taskType,
      chat_type: task.chatType,
    });
  }
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
