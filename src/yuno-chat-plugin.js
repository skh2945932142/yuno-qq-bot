export function createYunoChatPlugin({ runConversation } = {}) {
  return {
    name: 'yuno-chat',
    priority: 100,
    match() {
      return true;
    },
    async handle(context) {
      return runConversation(context.input, {
        responseMode: 'capture',
      });
    },
  };
}
