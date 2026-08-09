function required(name, value) {
  if (typeof value !== 'function') throw new Error('LEGACY_WORKFLOW_PORT_' + name + '_REQUIRED');
  return value;
}

/**
 * Transitional port around stable public APIs. It lets callers move to the
 * application boundary before each legacy workflow slice is extracted.
 */
export function createLegacyWorkflowPort(operations = {}) {
  return Object.freeze({
    shouldRespondToEvent: required('DECIDE', operations.shouldRespondToEvent),
    processIncomingMessage: required('PROCESS_INCOMING', operations.processIncomingMessage),
    processPersistJob: required('PERSIST', operations.processPersistJob),
    processReplyJob: required('REPLY_JOB', operations.processReplyJob),
    handleInboundEvent: required('HANDLE_INBOUND', operations.handleInboundEvent),
  });
}
