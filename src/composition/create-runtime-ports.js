import {
  ensureRelation,
  ensureUserState,
  updateRelationProfile,
  updateUserState,
} from '../session-state.js';
import { getConversationState, appendConversationMessages } from '../conversation-memory.js';
import { ensureUserProfileMemory, updateUserProfileMemory } from '../profile-memory.js';
import {
  indexMemeAssetSemantics,
  indexUserMemoryEvents,
  retrieveMemoryContext,
} from '../memory-retrieval.js';
import { collectMemeAssetForEvent } from '../meme-collector.js';
import { persistUserMemoryEvents, touchReferencedMemoryEvents } from '../user-memory-events.js';
import { retrieveKnowledge } from '../knowledge-base.js';
import { retrieveReplyStyleExamples } from '../reply-style-retriever.js';
import { retrieveGroupDialogueContext } from '../group-dialogue.js';
import { rewriteRetrievalQuery } from '../retrieval-query.js';
import { analyzeMessage, chat, tts } from '../minimax.js';
import { toolRegistry } from '../tools/registry.js';
import { sendReply, sendStructuredReply, sendVoice } from '../sender.js';
import { logger } from '../logger.js';
import { analyzeTrigger, analyzeTriggerFast } from '../message-analysis.js';
import { ensureGroupState, getRecentEvents } from '../state/group-state-runtime.js';
import { getSpecialUserByUserId } from '../special-users.js';
import { createTraceContext, failTrace, finalizeTrace, withTraceSpan } from '../runtime-tracing.js';
import { recordWorkflowMetric } from '../metrics.js';
import { recordInboundMessageLog, recordOutboundMessageLog } from '../message-log.js';
import { createConversationPort } from '../application/ports/conversation-port.js';
import { createMemoryPort } from '../application/ports/memory-port.js';
import { createRetrievalPort } from '../application/ports/retrieval-port.js';
import { createModelPort } from '../application/ports/model-port.js';
import { createToolPort } from '../application/ports/tool-port.js';
import { createDeliveryPort } from '../application/ports/delivery-port.js';
import { createQueuePort } from '../application/ports/queue-port.js';
import { createTelemetryPort } from '../application/ports/telemetry-port.js';
import { createDecisionPort } from '../application/ports/decision-port.js';

/**
 * Infrastructure composition lives here, not inside application use cases.
 * Existing infrastructure modules remain in place during the incremental move.
 */
export function createRuntimePorts(options = {}) {
  const queueManager = options.queueManager || null;
  const deliveryAdapter = options.deliveryAdapter || null;
  const deliveryLedger = options.deliveryLedger || null;

  const delivery = createDeliveryPort({
    sendReply: deliveryAdapter?.sendReply?.bind(deliveryAdapter) || sendReply,
    sendStructuredReply: deliveryAdapter?.sendStructuredReply?.bind(deliveryAdapter) || sendStructuredReply,
    sendVoice: deliveryAdapter?.sendVoice?.bind(deliveryAdapter) || sendVoice,
    executeTracked: deliveryLedger?.execute?.bind(deliveryLedger) || null,
  });

  return Object.freeze({
    conversation: createConversationPort({
      ensureRelation,
      ensureUserState,
      getConversationState,
      appendConversationMessages,
      updateRelationProfile,
      updateUserState,
    }),
    memory: createMemoryPort({
      ensureUserProfile: ensureUserProfileMemory,
      updateUserProfile: updateUserProfileMemory,
      retrieveContext: retrieveMemoryContext,
      persistEvents: persistUserMemoryEvents,
      indexEvents: indexUserMemoryEvents,
      touchEvents: touchReferencedMemoryEvents,
      collectMeme: collectMemeAssetForEvent,
      indexMeme: indexMemeAssetSemantics,
    }),
    retrieval: createRetrievalPort({
      retrieveKnowledge,
      retrieveReplyStyleExamples,
      retrieveGroupDialogueContext,
      rewriteQuery: rewriteRetrievalQuery,
    }),
    model: createModelPort({
      analyzeMessage,
      generateReply: chat,
      generateVoice: tts,
    }),
    decision: createDecisionPort({
      analyzeTriggerFast,
      analyzeTrigger,
      ensureGroupState,
      getRecentEvents,
      resolveSpecialUser: getSpecialUserByUserId,
    }),
    tools: createToolPort((...args) => toolRegistry.execute(...args)),
    delivery,
    jobs: createQueuePort({
      enqueueReply: queueManager?.enqueueReply?.bind(queueManager),
      enqueuePersist: queueManager?.enqueuePersist?.bind(queueManager),
    }),
    telemetry: createTelemetryPort({
      logger,
      recordMetric: recordWorkflowMetric,
      createTrace: createTraceContext,
    }),
    tracing: Object.freeze({
      createTraceContext,
      finalizeTrace,
      failTrace,
      withTraceSpan,
    }),
    protocol: options.protocolAdapter || null,
    logs: Object.freeze({
      recordInbound: recordInboundMessageLog,
      recordOutbound: recordOutboundMessageLog,
    }),
  });
}
