function required(name, value) {
  if (typeof value !== 'function') throw new Error('MODEL_PORT_' + name + '_REQUIRED');
  return value;
}

export function createModelPort(operations = {}) {
  return Object.freeze({
    analyzeMessage: required('ANALYZE_MESSAGE', operations.analyzeMessage),
    generateReply: required('GENERATE_REPLY', operations.generateReply),
    generateVoice: required('GENERATE_VOICE', operations.generateVoice),
  });
}
