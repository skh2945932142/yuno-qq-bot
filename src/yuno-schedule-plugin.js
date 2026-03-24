export function createYunoSchedulePlugin({ runConversation } = {}) {
  return {
    name: 'yuno-schedule',
    priority: 50,
    match(context) {
      const text = String(context.message || context.rawMessage || context.text || '');
      return /^\/(remind|schedule)\b/i.test(text);
    },
    async handle(context) {
      const text = String(context.input.rawMessage || '').replace(/^\/(remind|schedule)\b/i, '').trim() || 'this reminder';
      return runConversation(context.input, {
        responseMode: 'capture',
        toolResult: {
          tool: 'schedule_note',
          payload: { text },
          summary: '',
          visibility: 'default',
          safetyFlags: [],
        },
      });
    },
  };
}
