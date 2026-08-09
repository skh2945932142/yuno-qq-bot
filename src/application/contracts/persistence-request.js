/**
 * Deferred state changes produced by reply generation. It intentionally does
 * not include a delivery adapter or model client.
 */
export function createPersistenceRequest({ event, contextSnapshot = {}, payload = {}, taskMode = 'all' } = {}) {
  if (!event?.chatId || !event?.userId) {
    throw new Error('PERSISTENCE_REQUEST_EVENT_REQUIRED');
  }
  return Object.freeze({
    event,
    contextSnapshot,
    payload,
    taskMode: String(taskMode || 'all'),
  });
}
