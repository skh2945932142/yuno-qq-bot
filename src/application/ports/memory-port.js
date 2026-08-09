function optional(name, value) {
  return typeof value === 'function' ? value : async () => {
    throw new Error('MEMORY_PORT_' + name + '_UNAVAILABLE');
  };
}

export function createMemoryPort(operations = {}) {
  return Object.freeze({
    ensureUserProfile: optional('ENSURE_USER_PROFILE', operations.ensureUserProfile),
    updateUserProfile: optional('UPDATE_USER_PROFILE', operations.updateUserProfile),
    retrieveContext: optional('RETRIEVE_CONTEXT', operations.retrieveContext),
    persistEvents: optional('PERSIST_EVENTS', operations.persistEvents),
    indexEvents: optional('INDEX_EVENTS', operations.indexEvents),
    touchEvents: optional('TOUCH_EVENTS', operations.touchEvents),
    collectMeme: optional('COLLECT_MEME', operations.collectMeme),
    indexMeme: optional('INDEX_MEME', operations.indexMeme),
  });
}
