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
import { buildScheduledPrompt } from '../prompts/index.js';
import { createTraceContext, failTrace, finalizeTrace, withTraceSpan } from '../observability/tracing.js';

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

export function startScheduler() {
  if (!config.targetGroupId) {
    logger.info('scheduler', 'Scheduler disabled because TARGET_GROUP_ID is not set');
    return;
  }

  cron.schedule('0 20 * * *', () => {
    const delay = Math.floor(Math.random() * 90 * 60 * 1000);
    setTimeout(() => {
      runScheduledInteraction(config.targetGroupId);
    }, delay);
  }, { timezone: 'Asia/Shanghai' });

  logger.info('scheduler', 'Scheduler started', { groupId: config.targetGroupId });
}
