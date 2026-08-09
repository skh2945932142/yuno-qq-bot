import { createInboundMessage } from '../contracts/inbound-message.js';
import { createReplyDecision } from '../contracts/reply-decision.js';
import { shouldUseLightweightReplyContext } from '../../domain/reply-decision-policy.js';

const PRIVATE_SEMANTIC_TIMEOUT_MS = 3000;

function getMethod(overrides, port, name) {
  return overrides?.[name] || port?.[name] || null;
}

function createTrace(ports, event, options) {
  if (options.trace) return options.trace;
  return ports?.tracing?.createTraceContext?.('should-respond', {
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
    messageId: event.messageId,
    queueJobId: options.queueJobId,
  }) || null;
}

async function withTraceSpan(ports, trace, name, task, attributes = {}) {
  if (typeof ports?.tracing?.withTraceSpan === 'function' && trace) {
    return ports.tracing.withTraceSpan(trace, name, task, attributes);
  }
  return task();
}

function recordMetric(ports, name, value, labels = {}, type) {
  ports?.telemetry?.recordMetric?.(name, value, labels, type);
}

function finalize(ports, trace, payload) {
  if (trace) ports?.tracing?.finalizeTrace?.(trace, payload);
}

function fail(ports, trace, error, payload) {
  if (trace) ports?.tracing?.failTrace?.(trace, error, payload);
}

async function buildContext(event, trace, ports, overrides, runtimeConfig, options = {}) {
  const conversation = ports?.conversation;
  const memory = ports?.memory;
  const decision = ports?.decision;
  const ensureRelation = getMethod(overrides, conversation, 'ensureRelation');
  const ensureUserState = getMethod(overrides, conversation, 'ensureUserState');
  const ensureUserProfile = overrides?.ensureUserProfileMemory
    || overrides?.ensureUserProfile
    || memory?.ensureUserProfile;
  const getConversationState = getMethod(overrides, conversation, 'getConversationState');
  const ensureGroupState = getMethod(overrides, decision, 'ensureGroupState');
  const getRecentEvents = getMethod(overrides, decision, 'getRecentEvents');
  const resolveSpecialUser = getMethod(overrides, decision, 'resolveSpecialUser');

  if (![ensureRelation, ensureUserState, ensureUserProfile, getConversationState, resolveSpecialUser].every(Boolean)) {
    throw new Error('DECIDE_REPLY_CONTEXT_PORT_REQUIRED');
  }

  const session = {
    platform: event.platform,
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
  };
  const isAdvanced = event.chatType === 'group'
    && Boolean(runtimeConfig.targetGroupId)
    && String(event.chatId) === String(runtimeConfig.targetGroupId);
  const lightweight = Boolean(options.lightweight);
  const specialUser = resolveSpecialUser(event.userId);

  const [relation, userState, userProfile, conversationState, groupState, recentEvents] = await withTraceSpan(
    ports,
    trace,
    'load-context',
    () => Promise.all([
      ensureRelation(session),
      ensureUserState(session),
      ensureUserProfile({
        platform: event.platform,
        userId: event.userId,
        userName: event.userName,
        specialUser,
      }),
      getConversationState(session),
      isAdvanced && !lightweight && ensureGroupState ? ensureGroupState(event.chatId) : Promise.resolve(null),
      event.chatType === 'group' && !lightweight && getRecentEvents ? getRecentEvents(event.chatId, 5) : Promise.resolve([]),
    ]),
    {
      chatType: event.chatType,
      chatId: event.chatId,
      userId: event.userId,
      contextMode: lightweight ? 'lightweight' : 'full',
    }
  );

  return {
    event,
    session,
    runtimeConfig,
    relation,
    userState,
    userProfile,
    conversationState,
    groupState,
    recentEvents,
    memoryContext: { eventMemories: [], memeMemories: [] },
    specialUser,
    isAdmin: String(event.userId) === String(runtimeConfig.adminQq || ''),
    isAdvanced,
    contextMode: lightweight ? 'lightweight' : 'full',
  };
}

async function resolvePrivateSemanticAnalysis(event, fastAnalysis, ports, overrides, trace, runtimeConfig) {
  if (runtimeConfig.privateSemanticAnalysisEnabled === false) return null;
  if (shouldUseLightweightReplyContext(event, fastAnalysis)) return null;

  const analyzeMessage = overrides?.analyzeMessage || ports?.model?.analyzeMessage;
  if (typeof analyzeMessage !== 'function') return null;
  const text = String(event.rawText || event.text || '').replace(/[CQ:[^]]+]/g, '');
  if (!text) return null;

  const timeoutMs = Math.max(500, Number(runtimeConfig.privateSemanticTimeoutMs || PRIVATE_SEMANTIC_TIMEOUT_MS));
  let timer = null;
  try {
    const semantic = await Promise.race([
      analyzeMessage(text, {
        isAdmin: String(event.userId || '') === String(runtimeConfig.adminQq || ''),
        ruleSignals: fastAnalysis.ruleSignals || [],
      }, {
        traceContext: trace,
        operation: 'private-semantic-analysis',
        timeoutMs,
        retries: 0,
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    recordMetric(ports, 'yuno_private_semantic_analysis_total', 1, { result: semantic ? 'ok' : 'timeout' });
    return semantic;
  } catch (error) {
    recordMetric(ports, 'yuno_private_semantic_analysis_total', 1, { result: 'failed' });
    ports?.telemetry?.logger?.warn?.('analysis', 'Private semantic analysis failed; keeping rule signals', {
      traceId: trace?.traceId,
      chatId: event.chatId,
      userId: event.userId,
      message: error.message,
    });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mergePrivateSemanticAnalysis(fastAnalysis, semantic) {
  if (!semantic) return fastAnalysis;
  return {
    ...fastAnalysis,
    intent: semantic.intent || fastAnalysis.intent,
    sentiment: semantic.sentiment || fastAnalysis.sentiment,
    topics: Array.isArray(semantic.topics) && semantic.topics.length > 0 ? semantic.topics : fastAnalysis.topics,
    replyStyle: semantic.replyStyle || fastAnalysis.replyStyle,
    confidence: Math.max(Number(fastAnalysis.confidence || 0), Number(semantic.confidence || 0)),
    semanticSource: 'llm',
  };
}

async function decideWithPorts(event, options, config, ports) {
  const overrides = options.deps || {};
  const inbound = createInboundMessage(event);
  const trace = createTrace(ports, inbound, options);
  const decisionPort = ports?.decision;
  const analyzeTriggerFast = getMethod(overrides, decisionPort, 'analyzeTriggerFast');
  const analyzeTrigger = getMethod(overrides, decisionPort, 'analyzeTrigger');
  if (!analyzeTriggerFast || !analyzeTrigger) throw new Error('DECIDE_REPLY_TRIGGER_PORT_REQUIRED');

  try {
    const fastAnalysis = await analyzeTriggerFast(inbound, { ...options, traceContext: trace });
    if (fastAnalysis) {
      recordMetric(ports, 'yuno_trigger_fast_path_total', 1, {
        chat_type: inbound.chatType,
        reason: fastAnalysis.reason,
      });

      if (inbound.chatType === 'private') {
        const [context, semantic] = await Promise.all([
          buildContext(inbound, trace, ports, overrides, options.runtimeConfig || config, {
            lightweight: shouldUseLightweightReplyContext(inbound, fastAnalysis),
          }),
          resolvePrivateSemanticAnalysis(inbound, fastAnalysis, ports, overrides, trace, options.runtimeConfig || config),
        ]);
        const analysis = mergePrivateSemanticAnalysis(fastAnalysis, semantic);
        recordMetric(ports, 'yuno_trigger_decisions_total', 1, {
          chat_type: inbound.chatType,
          decision: analysis.shouldRespond ? 'allow' : 'deny',
          reason: analysis.reason,
        });
        if (options.finalizeTrace !== false) {
          finalize(ports, trace, {
            shouldRespond: analysis.shouldRespond,
            reason: analysis.reason,
            chatType: inbound.chatType,
            messageId: inbound.messageId,
            decisionReason: analysis.reason,
            fastPath: true,
            semanticSource: analysis.semanticSource || 'rules',
          });
        }
        return { ...context, event: inbound, analysis, trace };
      }

      recordMetric(ports, 'yuno_trigger_decisions_total', 1, {
        chat_type: inbound.chatType,
        decision: fastAnalysis.shouldRespond ? 'allow' : 'deny',
        reason: fastAnalysis.reason,
      });
      if (options.finalizeTrace !== false) {
        finalize(ports, trace, {
          shouldRespond: fastAnalysis.shouldRespond,
          reason: fastAnalysis.reason,
          chatType: inbound.chatType,
          messageId: inbound.messageId,
          decisionReason: fastAnalysis.reason,
          fastPath: true,
        });
      }
      return {
        event: inbound,
        session: {
          platform: inbound.platform,
          chatType: inbound.chatType,
          chatId: inbound.chatId,
          userId: inbound.userId,
        },
        analysis: fastAnalysis,
        trace,
      };
    }

    const context = await buildContext(inbound, trace, ports, overrides, options.runtimeConfig || config);
    const analysis = await withTraceSpan(
      ports,
      trace,
      'analyze-trigger',
      () => analyzeTrigger(inbound, context, { ...options, traceContext: trace }),
      { advancedMode: context.isAdvanced, chatType: inbound.chatType }
    );
    recordMetric(ports, 'yuno_trigger_decisions_total', 1, {
      chat_type: inbound.chatType,
      decision: analysis.shouldRespond ? 'allow' : 'deny',
      reason: analysis.reason,
    });
    if (options.finalizeTrace !== false) {
      finalize(ports, trace, {
        shouldRespond: analysis.shouldRespond,
        reason: analysis.reason,
        chatType: inbound.chatType,
        messageId: inbound.messageId,
        decisionReason: analysis.reason,
        fastPath: false,
      });
    }
    return { ...context, analysis, trace };
  } catch (error) {
    fail(ports, trace, error, {
      chatType: inbound.chatType,
      chatId: inbound.chatId,
      userId: inbound.userId,
      messageId: inbound.messageId,
    });
    throw error;
  }
}

/**
 * Decision boundary. Production uses explicit ports; legacy workflow calls are
 * retained only for callers that have not yet been composed with those ports.
 */
export function createDecideReplyUseCase({ config, ports, legacyWorkflow } = {}) {
  return async function decideReply(event, options = {}) {
    const result = ports?.decision
      ? await decideWithPorts(event, options, config, ports)
      : await legacyWorkflow.shouldRespondToEvent(createInboundMessage(event), {
        ...options,
        runtimeConfig: options.runtimeConfig || config,
      });
    const contract = createReplyDecision({
      event: result.event,
      analysis: result.analysis || {},
      context: result || null,
      task: result.task || null,
      trace: result.trace || options.trace || null,
    });
    return { ...result, contract };
  };
}

export { buildContext as buildDecisionContext, shouldUseLightweightReplyContext };
