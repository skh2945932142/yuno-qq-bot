import {
  buildWorkflowContext,
  processIncomingMessage,
  shouldRespondToEvent,
} from './message-workflow.js';
import { normalizeLegacyMessageEvent } from './chat/session.js';
import { createTraceContext, finalizeTrace } from './runtime-tracing.js';
import { handleInboundEvent } from './inbound-event-service.js';
import { withConversationExecution } from './conversation-executor.js';
import { sendReply, sendStructuredReply, sendVoice } from './sender.js';
import { getRuntimeServices } from './runtime-services.js';
import { executeTrackedDelivery } from './delivery-ledger.js';
import { resolveUserPersonaPolicy } from './persona-policy.js';
import {
  formatToolResultAsYuno,
  normalizeFormatterOutputs,
} from './yuno-formatter.js';

function normalizeScene(scene) {
  return String(scene || 'group').trim().toLowerCase() === 'private' ? 'private' : 'group';
}

function normalizePluginRoute(pluginRoute, event) {
  if (!pluginRoute) {
    return null;
  }

  if (typeof pluginRoute === 'object') {
    return pluginRoute;
  }

  const category = String(pluginRoute).trim() || (event.chatType === 'private' ? 'private_chat' : 'group_chat');
  return {
    type: 'chat',
    category,
    requiresModel: true,
    requiresRetrieval: category === 'knowledge_qa',
    allowFollowUp: event.chatType === 'private',
    reason: `plugin-route:${category}`,
  };
}

export function buildYunoCoreEvent({
  platform = 'qq',
  scene = 'group',
  userId,
  groupId = '',
  chatId = '',
  username = '',
  rawMessage = '',
  metadata = {},
}) {
  const chatType = normalizeScene(scene || metadata.chatType);
  const resolvedChatId = String(chatId || (chatType === 'group' ? groupId : userId) || '').trim();

  return normalizeLegacyMessageEvent({
    platform,
    chatType,
    chatId: resolvedChatId,
    userId: String(userId || '').trim(),
    userName: username || metadata.userName || String(userId || '').trim() || 'user',
    messageId: metadata.messageId || '',
    replyTo: metadata.replyTo || '',
    rawText: String(rawMessage || ''),
    text: metadata.text || String(rawMessage || ''),
    mentionsBot: Boolean(metadata.mentionsBot),
    attachments: Array.isArray(metadata.attachments) ? metadata.attachments : [],
    timestamp: Number.isFinite(metadata.timestamp) ? metadata.timestamp : Date.now(),
    source: {
      adapter: metadata.adapter || platform,
      ...metadata.source,
    },
    selfId: metadata.selfId || '',
    sender: metadata.sender || {},
  });
}

function createOutputCollector() {
  return {
    replies: [],
    voices: [],
    outputs: [],
  };
}

function appendStructuredOutputs(output, target, outputs = []) {
  for (const item of outputs) {
    if (!item) {
      continue;
    }

    output.outputs.push({
      target,
      ...item,
    });

    if (item.type === 'text') {
      output.replies.push({
        type: 'text',
        target,
        text: item.text,
      });
      continue;
    }

    if (item.type === 'image') {
      output.replies.push({
        type: 'image',
        target,
        image: item.image,
      });
    }
  }
}

function buildCapturedResponse(output, fallbackText = '') {
  const texts = [];
  const normalizedFallback = String(fallbackText || '').trim();
  if (normalizedFallback) {
    texts.push(normalizedFallback);
  }

  for (const reply of output.replies) {
    if (reply?.type !== 'text') continue;
    const text = String(reply.text || '').trim();
    if (text) texts.push(text);
  }

  return {
    text: [...new Set(texts)].join('\n'),
    voices: output.voices,
    outputs: output.outputs,
  };
}

function hasCapturedOutput(output) {
  return output.replies.length > 0 || output.voices.length > 0 || output.outputs.length > 0;
}

function createRuntimeDeps(output, options = {}) {
  const responseMode = options.responseMode === 'send' ? 'send' : 'capture';
  const replySender = options.deps?.sendReply || sendReply;
  const structuredSender = options.deps?.sendStructuredReply || sendStructuredReply;
  const voiceSender = options.deps?.sendVoice || sendVoice;
  const deliveryLedgerEnabled = responseMode === 'send' && options.deps?.disableDeliveryLedger !== true;
  const runtimeServices = getRuntimeServices();
  const runtimeDelivery = deliveryLedgerEnabled
    ? runtimeServices.deliveryLedger?.execute?.bind(runtimeServices.deliveryLedger) : null;

  return {
    executeDelivery: deliveryLedgerEnabled ? (options.deps?.executeDelivery || runtimeDelivery) : null,
    sendReply: async (target, text) => {
      appendStructuredOutputs(output, target, [{ type: 'text', text }]);
      if (responseMode === 'send') {
        await replySender(target, text);
      }
      return true;
    },
    sendStructuredReply: async (target, outputsToSend) => {
      appendStructuredOutputs(output, target, outputsToSend);
      if (responseMode === 'send') {
        await structuredSender(target, outputsToSend);
      }
      return true;
    },
    sendVoice: async (target, audio) => {
      output.voices.push({
        type: 'voice',
        target,
        audio,
      });
      if (responseMode === 'send') {
        await voiceSender(target, audio);
      }
      return true;
    },
  };
}

async function formatStructuredToolReply(event, options, output) {
  const deps = {
    ...(options.deps || {}),
  };
  if (typeof deps.retrieveMemoryContext !== 'function') {
    deps.retrieveMemoryContext = async () => ({
      eventMemories: [],
      memeMemories: [],
    });
  }
  const trace = options.trace || createTraceContext('tool-result', {
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
    messageId: event.messageId,
    route: options.pluginRoute || null,
    tool: options.toolResult?.tool || null,
  });
  const context = options.context || await buildWorkflowContext(event, trace, {
    ...deps,
  });
  const policy = (options.resolveUserPersonaPolicy || resolveUserPersonaPolicy)({
    userId: event.userId,
    scene: event.chatType,
    relation: context.relation,
    basePersona: 'yuno',
  });
  const text = formatToolResultAsYuno(options.toolResult, policy);
  const structuredOutputs = normalizeFormatterOutputs(options.toolResult, text);
  const mergedDeps = {
    ...deps,
    ...createRuntimeDeps(output, options),
  };

  const target = {
    platform: event.platform,
    chatType: event.chatType,
    chatId: event.chatId,
  };
  const deliveryKind = options.deliveryKind || 'primary';
  const delivery = await executeTrackedDelivery({
    executeDelivery: mergedDeps.executeDelivery,
    event,
    kind: deliveryKind,
    task: () => mergedDeps.sendStructuredReply(target, structuredOutputs),
    explicitKey: options.deliveryKey,
  });

  return {
    ok: true,
    suppressed: false,
    event,
    analysis: {
      shouldRespond: true,
      reason: 'tool-result',
      route: options.pluginRoute || null,
    },
    delivery,
    outputs: output,
    response: {
      text,
      voices: output.voices,
      outputs: structuredOutputs,
      toolResult: options.toolResult,
    },
    context,
    policy,
  };
}

async function dispatchCoreAutomationToolResults(event, toolResults, options, output, trace) {
  const results = [];
  for (const [index, toolResult] of toolResults.entries()) {
    results.push(await formatStructuredToolReply(event, {
      ...options,
      trace,
      toolResult,
      deliveryKind: `automation-${index}-${toolResult?.tool || 'unknown'}`,
    }, output));
  }
  return results;
}

function shouldUseInboundLifecycle(options = {}) {
  return options.processInboundLifecycle ?? !options.engine;
}

export async function runYunoConversation(input, options = {}) {
  const event = input?.platform && input?.chatType
    ? normalizeLegacyMessageEvent(input)
    : buildYunoCoreEvent(input);
  const output = createOutputCollector();

  if (options.toolResult) {
    return formatStructuredToolReply(event, options, output);
  }

  return withConversationExecution(event, async () => {
  const trace = options.trace || createTraceContext('conversation', {
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
    messageId: event.messageId,
    source: event.source?.adapter || event.platform,
  });
  const runtimeDeps = createRuntimeDeps(output, options);
  const pluginRoute = normalizePluginRoute(options.pluginRoute, event);
  const mergedDeps = {
    ...(options.deps || {}),
    ...runtimeDeps,
  };

  if (pluginRoute) {
    mergedDeps.planIncomingTask = () => pluginRoute;
  }

  const shouldRespond = options.engine?.shouldRespondToEvent || shouldRespondToEvent;
  const deferPostReplyEffects = options.deferPostReplyEffects ?? options.responseMode !== 'send';
  const processMessage = options.engine?.processIncomingMessage || processIncomingMessage;
  const processApprovedReply = async ({ decision }) => processMessage(event, decision, {
    ...options,
    trace,
    deps: mergedDeps,
    persistInline: !deferPostReplyEffects,
    deferPostReplyEffects,
  });

  let lifecycleResult;
  if (shouldUseInboundLifecycle(options)) {
    const inboundHandler = options.engine?.handleInboundEvent || handleInboundEvent;
    lifecycleResult = await inboundHandler(event, {
      decisionOptions: {
        ...options,
        trace,
        deps: mergedDeps,
        finalizeTrace: false,
      },
      deps: {
        isNonTargetPokeEvent: options.deps?.isNonTargetPokeEvent,
        observeGroupEvent: options.deps?.observeGroupEvent || options.deps?.observeGroupEventInBackground,
        evaluateGroupAutomation: options.deps?.evaluateGroupAutomation,
        recordWorkflowMetric: options.deps?.recordWorkflowMetric,
        logger: options.deps?.logger,
        shouldRespondToEvent: (normalizedEvent, decisionOptions) => shouldRespond(normalizedEvent, {
          ...decisionOptions,
          deps: mergedDeps,
        }),
        dispatchAutomationToolResults: options.deps?.dispatchAutomationToolResults
          || ((normalizedEvent, toolResults) => dispatchCoreAutomationToolResults(
            normalizedEvent,
            toolResults,
            options,
            output,
            trace
          )),
        onReplyApproved: processApprovedReply,
      },
    });
  } else {
    const decision = await shouldRespond(event, {
      ...options,
      trace,
      deps: mergedDeps,
      finalizeTrace: false,
    });
    lifecycleResult = decision.analysis.shouldRespond
      ? {
          suppressed: false,
          reason: decision.analysis.reason,
          analysis: decision.analysis,
          decision,
          replyResult: await processApprovedReply({ decision }),
        }
      : {
          suppressed: true,
          reason: decision.analysis.reason,
          analysis: decision.analysis,
          decision,
          replyResult: null,
        };
  }

  if (lifecycleResult.suppressed) {
    const captured = hasCapturedOutput(output);
    finalizeTrace(trace, {
      replyType: captured ? 'automation' : 'suppressed',
      shouldRespond: captured,
      reason: lifecycleResult.reason,
      messageId: event.messageId,
    });
    return {
      ok: true,
      suppressed: !captured,
      event,
      analysis: lifecycleResult.analysis,
      outputs: output,
      response: captured ? buildCapturedResponse(output) : null,
    };
  }

  const replyText = lifecycleResult.replyResult;
  if (options.engine?.processIncomingMessage) {
    finalizeTrace(trace, {
      replyType: 'chat',
      shouldRespond: true,
      reason: lifecycleResult.reason,
      messageId: event.messageId,
    });
  }

  return {
    ok: true,
    suppressed: false,
    event,
    analysis: lifecycleResult.analysis,
    outputs: output,
    response: buildCapturedResponse(output, replyText),
  };
  });
}