import { createInboundMessage } from '../contracts/inbound-message.js';
import { createReplyPlan } from '../contracts/reply-plan.js';

function normalizeOutputs(outputs = []) {
  return (Array.isArray(outputs) ? outputs : []).filter((output) => {
    if (!output) return false;
    if (output.type === 'text') return Boolean(String(output.text || '').trim());
    return output.type === 'image' && Boolean(output.image);
  });
}

function createCaptureDeps(overrides = {}, captured) {
  return {
    ...overrides,
    // Generation may exercise the existing kernel, but it never gets a live
    // delivery adapter or a state writer. It returns an explicit ReplyPlan.
    disableDeliveryLedger: true,
    executeDelivery: null,
    recordInboundMessageLog: async () => null,
    recordOutboundMessageLog: async () => null,
    sendReply: async (target, text) => {
      captured.target ||= target;
      captured.outputs.push({ type: 'text', text: String(text || '') });
      return true;
    },
    sendStructuredReply: async (target, outputs) => {
      captured.target ||= target;
      captured.outputs.push(...normalizeOutputs(outputs));
      return true;
    },
    sendVoice: async (target, audio) => {
      captured.target ||= target;
      captured.voice = { shouldSend: true, audio };
      return true;
    },
    enqueuePersistJob: async (payload, queueOptions = {}) => {
      captured.persistence ??= { payload, queueOptions };
      return { id: queueOptions.jobId || 'captured-persist' };
    },
  };
}

/**
 * Runs the legacy generation kernel in a capture-only sandbox. This is the
 * migration seam that separates LLM/RAG/tool work from QQ delivery and state
 * mutation without changing the established reply behavior.
 */
export function createGenerateReplyUseCase({ config, legacyWorkflow } = {}) {
  if (!legacyWorkflow?.processIncomingMessage) {
    throw new Error('GENERATE_REPLY_LEGACY_WORKFLOW_REQUIRED');
  }

  return async function generateReply(event, decision = null, options = {}) {
    const inbound = createInboundMessage(event);
    const captured = {
      target: null,
      outputs: [],
      voice: null,
      persistence: null,
    };
    const replyText = await legacyWorkflow.processIncomingMessage(inbound, decision, {
      ...options,
      runtimeConfig: options.runtimeConfig || config,
      responseMode: 'capture',
      persistInline: false,
      deferPostReplyEffects: false,
      deps: createCaptureDeps(options.deps, captured),
    });
    const outputs = normalizeOutputs(captured.outputs);
    if (outputs.length === 0 && String(replyText || '').trim()) {
      outputs.push({ type: 'text', text: String(replyText).trim() });
    }
    const target = captured.target || {
      platform: inbound.platform,
      chatType: inbound.chatType,
      chatId: inbound.chatId,
    };
    const replyPlan = createReplyPlan({
      event: inbound,
      target,
      outputs,
      voice: captured.voice,
      deliveryKey: options.deliveryKey || '',
      persistence: captured.persistence?.payload || null,
      metadata: {
        replyText: String(replyText || ''),
        queueOptions: captured.persistence?.queueOptions || null,
        route: decision?.analysis?.route || decision?.analysis?.reason || '',
      },
    });
    return { replyText, replyPlan };
  };
}
