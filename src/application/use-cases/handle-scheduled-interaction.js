import { createReplyPlan } from '../contracts/reply-plan.js';

function buildDeliveryKey(groupId, now, plan) {
  const hour = new Date(now).toISOString().slice(0, 13);
  return 'scheduler:proactive:' + String(groupId) + ':' + hour + ':'
    + String(plan.reason || plan.topic || 'message');
}

function wasDelivered(result) {
  const delivery = result?.delivery || result;
  return Boolean(delivery?.sent || delivery?.deduplicated || delivery?.status === 'sent');
}

async function withSpan(deps, trace, name, task, attributes = {}) {
  if (typeof deps.withTraceSpan === 'function') {
    return deps.withTraceSpan(trace, name, task, attributes);
  }
  return task();
}

/**
 * Application use case for proactive group messages. Scheduler provides timing
 * and infrastructure dependencies; delivery always goes through DeliverReply.
 */
export async function handleScheduledInteraction(command = {}, deps = {}) {
  const groupId = String(command.groupId || '').trim();
  const runtimeConfig = command.runtimeConfig || {};
  const now = command.now || new Date();
  const trace = deps.createTraceContext?.('scheduled-interaction', { groupId });

  if (runtimeConfig.proactiveMessagesEnabled === false) {
    deps.logSchedulerSkip?.('proactive-disabled');
    deps.finalizeTrace?.(trace, { shouldSend: false, reason: 'proactive-disabled' });
    return { skipped: true, reason: 'proactive-disabled' };
  }

  try {
    const [groupState, recentEvents] = await withSpan(deps, trace, 'load-group-state', () => Promise.all([
      deps.ensureGroupState(groupId),
      deps.getRecentEvents(groupId, 3),
    ]));
    const plan = deps.planScheduledInteraction({
      groupState,
      recentEvents,
      dateContext: now,
      timeZone: runtimeConfig.dailyMoodTimezone,
      runtimeConfig,
    });

    if (!plan.shouldSend) {
      deps.logSchedulerSkip?.(plan.reason);
      deps.finalizeTrace?.(trace, { shouldSend: false, reason: plan.reason });
      return { skipped: true, reason: plan.reason, plan };
    }

    const text = await withSpan(deps, trace, 'generate-message', () => deps.generateReply(
      [],
      deps.buildScheduledPrompt({ groupState, recentEvents, plan }),
      'Send one proactive message that matches the current group atmosphere.',
      {
        traceContext: trace,
        promptVersion: 'scheduled-message/v1',
        operation: 'scheduled-reply',
      }
    ));
    const replyPlan = createReplyPlan({
      event: {
        platform: 'qq',
        chatType: 'group',
        chatId: groupId,
        userId: String(runtimeConfig.adminQq || 'scheduler'),
        userName: 'Scheduler',
        messageId: 'proactive:' + new Date(now).toISOString(),
        timestamp: new Date(now).getTime(),
      },
      target: { platform: 'qq', chatType: 'group', chatId: groupId },
      outputs: [{ type: 'text', text }],
      deliveryKey: buildDeliveryKey(groupId, now, plan),
      metadata: { deliveryKind: 'proactive', topic: plan.topic, tone: plan.tone },
    });
    const delivery = await withSpan(deps, trace, 'send-message', () => deps.deliverReply(replyPlan));
    if (!wasDelivered(delivery)) {
      const error = new Error('Scheduled interaction was not delivered');
      error.code = 'SCHEDULED_DELIVERY_NOT_SENT';
      throw error;
    }
    await withSpan(deps, trace, 'mark-proactive', () => deps.markProactiveSent(groupId));

    deps.logger?.info?.('scheduler', 'Proactive group message sent', {
      groupId,
      topic: plan.topic,
      tone: plan.tone,
      traceId: trace?.traceId,
      deliveryKey: replyPlan.deliveryKey,
    });
    deps.finalizeTrace?.(trace, {
      shouldSend: true,
      topic: plan.topic,
      tone: plan.tone,
      deliveryKey: replyPlan.deliveryKey,
    });
    return { skipped: false, plan, replyPlan, delivery };
  } catch (error) {
    deps.failTrace?.(trace, error);
    deps.logger?.error?.('scheduler', 'Scheduled interaction failed', {
      message: error.message,
      traceId: trace?.traceId,
    });
    return { skipped: false, failed: true, error };
  }
}
