import { createPersistenceRequest } from '../contracts/persistence-request.js';

/**
 * Persistence is intentionally separated from reply generation and delivery.
 * The underlying state writer remains compatible while legacy work is drained.
 */
export function createPersistReplyUseCase({ config, legacyWorkflow } = {}) {
  if (!legacyWorkflow?.processPersistJob) {
    throw new Error('PERSIST_REPLY_LEGACY_WORKFLOW_REQUIRED');
  }

  return async function persistReply(request, options = {}) {
    const normalized = createPersistenceRequest(request);
    return legacyWorkflow.processPersistJob({
      event: normalized.event,
      contextSnapshot: normalized.contextSnapshot,
      ...normalized.payload,
      taskMode: normalized.taskMode,
    }, {
      ...options,
      runtimeConfig: options.runtimeConfig || config,
    });
  };
}
