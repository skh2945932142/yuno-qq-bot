function optional(value) {
  return typeof value === 'function' ? value : null;
}

export function createQueuePort(operations = {}) {
  return Object.freeze({
    enqueueReply: optional(operations.enqueueReply),
    enqueuePersist: optional(operations.enqueuePersist),
  });
}
