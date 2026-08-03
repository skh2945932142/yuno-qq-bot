import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';
import { isNonTargetPokeEvent } from './message-analysis.js';
import { recordInboundGroupObservation } from './group-ops.js';
import { evaluateGroupAutomation } from './group-automation.js';
import { shouldRespondToEvent } from './message-workflow.js';
import { recordParticipationReply, resolveParticipationDecision } from './participation-policy.js';
import { getRuntimeServices } from './runtime-services.js';
import { recordInboundMessageLog } from './message-log.js';

const groupObservationTails = new Map();

function withObservationTimeout(task, timeoutMs = 4000) {
  let timer = null;
  return Promise.race([
    Promise.resolve(task),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), Math.max(100, Number(timeoutMs || 4000)));
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createInboundDeps(deps = {}) {
  return {
    isNonTargetPokeEvent: deps.isNonTargetPokeEvent || isNonTargetPokeEvent,
    observeGroupEvent: deps.observeGroupEvent || recordInboundGroupObservation,
    evaluateGroupAutomation: deps.evaluateGroupAutomation || evaluateGroupAutomation,
    dispatchAutomationToolResults: deps.dispatchAutomationToolResults || (async () => []),
    shouldRespondToEvent: deps.shouldRespondToEvent || shouldRespondToEvent,
    onReplyApproved: deps.onReplyApproved || (async ({ decision }) => decision),
    recordWorkflowMetric: deps.recordWorkflowMetric || recordWorkflowMetric,
    resolveParticipationDecision: deps.resolveParticipationDecision || resolveParticipationDecision,
    recordParticipationReply: deps.recordParticipationReply || recordParticipationReply,
    recordInboundMessageLog: deps.recordInboundMessageLog || recordInboundMessageLog,
    reactToMessage: deps.reactToMessage || (async (event) => {
      const adapter = getRuntimeServices().protocolAdapter;
      if (typeof adapter?.reactToMessage !== 'function') return false;
      return adapter.reactToMessage({
        platform: event.platform,
        chatType: event.chatType,
        chatId: event.chatId,
      }, event.messageId);
    }),
    logger: deps.logger || logger,
    observationTimeoutMs: Number(deps.observationTimeoutMs || 4000),
  };
}

function startGroupObservation(event, deps) {
  const groupId = String(event.chatId || 'unknown');
  const previous = groupObservationTails.get(groupId) || Promise.resolve();
  const deadline = Date.now() + deps.observationTimeoutMs;
  const observation = previous
    .catch(() => {})
    .then(() => {
      const remainingMs = Math.max(100, deadline - Date.now());
      if (Date.now() >= deadline) return { timedOut: true };
      return withObservationTimeout(
        deps.observeGroupEvent(event),
        remainingMs
      );
    })
    .then((result) => {
      if (result?.timedOut) {
        deps.logger.warn('group-ops', 'Group observation timed out; continuing without it', {
          chatId: event.chatId,
          userId: event.userId,
          messageId: event.messageId,
          timeoutMs: deps.observationTimeoutMs,
        });
      }
      return result;
    })
    .catch((error) => {
      deps.logger.warn('group-ops', 'Failed to record inbound group observation', {
        message: error.message,
        chatId: event.chatId,
        userId: event.userId,
        messageId: event.messageId,
      });
      return null;
    });
  groupObservationTails.set(groupId, observation);
  observation.finally(() => {
    if (groupObservationTails.get(groupId) === observation) {
      groupObservationTails.delete(groupId);
    }
  });
  return observation;
}

async function evaluateAutomation(event, deps) {
  try {
    return await deps.evaluateGroupAutomation(event);
  } catch (error) {
    deps.logger.warn('automation', 'Failed to evaluate group automation', {
      message: error.message,
      chatId: event.chatId,
      userId: event.userId,
      messageId: event.messageId,
    });
    return null;
  }
}

async function dispatchAutomation(event, automationDecision, deps) {
  const toolResults = Array.isArray(automationDecision?.toolResults)
    ? automationDecision.toolResults
    : [];
  if (toolResults.length === 0) {
    return [];
  }

  const outputs = await deps.dispatchAutomationToolResults(event, toolResults);
  return Array.isArray(outputs) ? outputs : [];
}

function buildSuppressedResult(event, reason, extras = {}) {
  return {
    ok: true,
    event,
    suppressed: true,
    reason,
    analysis: extras.analysis || {
      shouldRespond: false,
      reason,
    },
    automationDecision: extras.automationDecision || null,
    automationOutputs: extras.automationOutputs || [],
    replyResult: null,
  };
}

export async function handleInboundEvent(event, options = {}) {
  const deps = createInboundDeps(options.deps);

  try {
    await deps.recordInboundMessageLog(event);
  } catch (error) {
    deps.logger.warn('memory', 'Inbound message log write failed', {
      chatId: event.chatId,
      messageId: event.messageId,
      message: error.message,
    });
  }

  if (event.chatType === 'group' && deps.isNonTargetPokeEvent(event)) {
    deps.recordWorkflowMetric('yuno_poke_ignored_total', 1, {
      chat_type: event.chatType,
      reason: 'non-target-poke',
    });
    deps.recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
      chat_type: event.chatType,
      reason: 'non-target-poke',
    });
    deps.logger.info('webhook', 'Ignored non-target poke event', {
      chatId: event.chatId,
      userId: event.userId,
      messageId: event.messageId,
      decisionReason: 'non-target-poke',
    });
    return buildSuppressedResult(event, 'non-target-poke');
  }

  let automationPromise = null;
  let observationPromise = null;
  if (event.chatType === 'group') {
    observationPromise = startGroupObservation(event, deps);
    automationPromise = evaluateAutomation(event, deps);

    if (event.source?.noticeType === 'group_increase') {
      const automationDecision = await automationPromise;
      const automationOutputs = await dispatchAutomation(event, automationDecision, deps);
      return buildSuppressedResult(event, 'automation-notice', {
        automationDecision,
        automationOutputs,
      });
    }
  }

  const decisionPromise = observationPromise
    ? observationPromise.then(() => deps.shouldRespondToEvent(event, options.decisionOptions || {}))
    : deps.shouldRespondToEvent(event, options.decisionOptions || {});
  const [decision, automationDecision] = await Promise.all([
    decisionPromise,
    automationPromise || Promise.resolve(null),
  ]);
  const automationOutputs = await dispatchAutomation(event, automationDecision, deps);

  if (automationDecision?.suppressNormalReply) {
    deps.recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
      chat_type: event.chatType,
      reason: 'automation-suppressed',
    });
    return buildSuppressedResult(event, 'automation-suppressed', {
      analysis: decision.analysis,
      automationDecision,
      automationOutputs,
    });
  }

  if (!decision.analysis.shouldRespond) {
    deps.recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
      chat_type: event.chatType,
      reason: decision.analysis.reason,
    });
    return buildSuppressedResult(event, decision.analysis.reason, {
      analysis: decision.analysis,
      automationDecision,
      automationOutputs,
    });
  }

  const participation = deps.resolveParticipationDecision({
    event,
    analysis: decision.analysis,
    runtimeConfig: options.decisionOptions?.runtimeConfig,
  }) || { mode: 'reply', reason: 'default-reply' };
  deps.recordWorkflowMetric('yuno_participation_decisions_total', 1, {
    mode: participation.mode,
    reason: participation.reason,
  });

  if (participation.mode === 'reaction') {
    let reacted = false;
    try {
      reacted = Boolean(await deps.reactToMessage(event));
    } catch (error) {
      deps.logger.warn('delivery', 'Reaction reply failed; suppressing silently', {
        chatId: event.chatId,
        messageId: event.messageId,
        message: error.message,
      });
    }
    deps.recordWorkflowMetric('yuno_reaction_replies_total', 1, {
      result: reacted ? 'sent' : 'skipped',
    });
    return buildSuppressedResult(event, 'participation-reaction', {
      analysis: decision.analysis,
      automationDecision,
      automationOutputs,
    });
  }

  if (participation.mode === 'skip') {
    deps.recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
      chat_type: event.chatType,
      reason: 'participation-skip',
    });
    return buildSuppressedResult(event, 'participation-skip', {
      analysis: decision.analysis,
      automationDecision,
      automationOutputs,
    });
  }

  deps.recordParticipationReply(event);
  const replyResult = await deps.onReplyApproved({
    event,
    decision,
    automationDecision,
  });

  return {
    ok: true,
    event,
    suppressed: false,
    reason: decision.analysis.reason,
    analysis: decision.analysis,
    decision,
    automationDecision,
    automationOutputs,
    replyResult,
  };
}
