function optional(name, value) {
  return typeof value === 'function' ? value : async () => {
    throw new Error('RETRIEVAL_PORT_' + name + '_UNAVAILABLE');
  };
}

export function createRetrievalPort(operations = {}) {
  return Object.freeze({
    retrieveKnowledge: optional('KNOWLEDGE', operations.retrieveKnowledge),
    retrieveReplyStyleExamples: optional('REPLY_STYLE', operations.retrieveReplyStyleExamples),
    retrieveGroupDialogueContext: optional('GROUP_DIALOGUE', operations.retrieveGroupDialogueContext),
    rewriteQuery: optional('REWRITE_QUERY', operations.rewriteQuery),
  });
}
