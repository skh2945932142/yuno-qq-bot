export function createYunoKnowledgePlugin({ runConversation } = {}) {
  return {
    name: 'yuno-knowledge',
    priority: 40,
    match(context) {
      const text = String(context.message || context.rawMessage || context.text || '');
      return /^\/kb\b/i.test(text) || /\b(faq|docs|manual|knowledge)\b/i.test(text);
    },
    async handle(context) {
      return runConversation(context.input, {
        responseMode: 'capture',
        pluginRoute: 'knowledge_qa',
      });
    },
  };
}
