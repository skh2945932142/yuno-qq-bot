import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';
import { isNonTargetPokeEvent } from './message-analysis.js';
import { recordInboundGroupObservation } from './group-ops.js';
import { evaluateGroupAutomation } from './group-automation.js';
import { shouldRespondToEvent } from './message-workflow.js';

function createInboundDeps(deps = {}) {
  return {
    isNonTargetPokeEvent: deps.isNonTargetPokeEvent || isNonTargetPokeEvent,
    observeGroupEvent: deps.observeGroupEvent || recordInboundGroupObservation,
    evaluateGroupAutomation: deps.evaluateGroupAutomation || evaluateGroupAutomation,
    dispatchAutomationToolResults: deps.dispatchAutomationToolResults || (async () => []),
    shouldRespondToEvent: deps.shouldRespondToEvent || shouldRespondToEvent,
    onReplyApproved: deps.onReplyApproved || (async ({ decision }) => decision),
    recordWorkflowMetric: deps.recordWorkflowMetric || recordWorkflowMetric,
    logger: deps.logger || logger,
  };
}

function startGroupObservation(event, deps) {
  try {
    const observation = deps.observeGroupEvent(event);
    Promise.resolve(observation).catch((error) => {
      deps.logger.warn('group-ops', 'Failed to record inbound group observation', {
        message: error.message,
        chatId: event.chatId,
        userId: event.userId,
        messageId: event.messageId,
      });
    });
  } catch (error) {
    deps.logger.warn('group-ops', 'Failed to start inbound group observation', {
      message: error.message,
      chatId: event.chatId,
      userId: event.userId,
      messageId: event.messageId,
    });
  }
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
  if (event.chatType === 'group') {
    startGroupObservation(event, deps);
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

  const decisionPromise = deps.shouldRespondToEvent(event, options.decisionOptions || {});
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
