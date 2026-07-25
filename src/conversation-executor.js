import { buildSessionKey } from './chat/session.js';
import { recordWorkflowMetric } from './metrics.js';

export function buildConversationExecutionKey(event = {}) {
  return buildSessionKey({
    platform: event.platform,
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
  });
}

export function createConversationExecutor(options = {}) {
  const tails = new Map();
  const idleWaiters = new Set();
  const recordMetric = options.recordWorkflowMetric || recordWorkflowMetric;

  function notifyIdle() {
    if (tails.size !== 0) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  return {
    async run(event, task) {
      const key = buildConversationExecutionKey(event);
      const previous = tails.get(key) || Promise.resolve();
      let release;
      const current = new Promise((resolve) => { release = resolve; });
      tails.set(key, current);
      const queuedAt = Date.now();

      await previous.catch(() => {});
      const waitMs = Date.now() - queuedAt;
      recordMetric('yuno_conversation_lock_wait_ms', waitMs, {
        chat_type: event.chatType || 'unknown',
      }, 'histogram');

      try {
        return await task();
      } finally {
        release();
        if (tails.get(key) === current) {
          tails.delete(key);
          notifyIdle();
        }
      }
    },
    size() {
      return tails.size;
    },
    async waitForIdle() {
      if (tails.size === 0) return;
      await new Promise((resolve) => idleWaiters.add(resolve));
    },
  };
}

const conversationExecutor = createConversationExecutor();

export function withConversationExecution(event, task) {
  return conversationExecutor.run(event, task);
}

export function getActiveConversationCount() {
  return conversationExecutor.size();
}

export function waitForConversationsIdle() {
  return conversationExecutor.waitForIdle();
}
