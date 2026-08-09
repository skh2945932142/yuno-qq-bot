function required(name, value) {
  if (typeof value !== 'function') throw new Error('CONVERSATION_PORT_' + name + '_REQUIRED');
  return value;
}

export function createConversationPort(operations = {}) {
  return Object.freeze({
    ensureRelation: required('ENSURE_RELATION', operations.ensureRelation),
    ensureUserState: required('ENSURE_USER_STATE', operations.ensureUserState),
    getConversationState: required('GET_STATE', operations.getConversationState),
    appendConversationMessages: required('APPEND_MESSAGES', operations.appendConversationMessages),
    updateRelationProfile: required('UPDATE_RELATION', operations.updateRelationProfile),
    updateUserState: required('UPDATE_USER_STATE', operations.updateUserState),
  });
}
