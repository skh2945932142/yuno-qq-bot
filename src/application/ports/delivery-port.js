function optional(value) {
  return typeof value === 'function' ? value : null;
}

/**
 * This port is implemented by the Koishi adapter composition. It never knows
 * about OneBot internals and keeps protocol access out of application code.
 */
export function createDeliveryPort(operations = {}) {
  if (typeof operations.sendReply !== 'function') {
    throw new Error('DELIVERY_PORT_SEND_REPLY_REQUIRED');
  }
  return Object.freeze({
    sendReply: operations.sendReply,
    sendStructuredReply: optional(operations.sendStructuredReply),
    sendVoice: optional(operations.sendVoice),
    executeTracked: optional(operations.executeTracked),
  });
}
