function required(name, value) {
  if (typeof value !== 'function') throw new Error('DECISION_PORT_' + name + '_REQUIRED');
  return value;
}

export function createDecisionPort(operations = {}) {
  return Object.freeze({
    analyzeTriggerFast: required('FAST_TRIGGER', operations.analyzeTriggerFast),
    analyzeTrigger: required('TRIGGER', operations.analyzeTrigger),
    ensureGroupState: required('ENSURE_GROUP_STATE', operations.ensureGroupState),
    getRecentEvents: required('GET_RECENT_EVENTS', operations.getRecentEvents),
    resolveSpecialUser: required('RESOLVE_SPECIAL_USER', operations.resolveSpecialUser),
  });
}
