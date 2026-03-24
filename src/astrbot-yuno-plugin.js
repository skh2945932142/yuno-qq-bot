import { runYunoConversation } from './yuno-core.js';
import { createAstrBotPluginRouter } from './astrbot-plugin-router.js';

function normalizeAstrBotScene(context = {}) {
  return String(context.scene || context.chatType || context.messageType || 'group').toLowerCase() === 'private'
    ? 'private'
    : 'group';
}

export function adaptAstrBotMessage(context = {}) {
  const scene = normalizeAstrBotScene(context);
  const userId = String(context.userId || context.sender?.userId || context.sender?.id || '').trim();
  const groupId = String(context.groupId || context.roomId || context.channelId || '').trim();
  const chatId = String(context.chatId || (scene === 'group' ? groupId : userId) || '').trim();
  const rawMessage = String(context.rawMessage || context.message || context.text || '').trim();

  return {
    platform: String(context.platform || 'astrbot').trim().toLowerCase() || 'astrbot',
    scene,
    userId,
    groupId,
    chatId,
    username: context.username || context.sender?.nickname || context.sender?.name || userId,
    rawMessage,
    metadata: {
      adapter: 'astrbot',
      messageId: context.messageId || context.id || '',
      replyTo: context.replyTo || '',
      mentionsBot: Boolean(context.mentionsBot),
      attachments: Array.isArray(context.attachments) ? context.attachments : [],
      timestamp: Number.isFinite(context.timestamp) ? context.timestamp : Date.now(),
      source: {
        platform: context.platform || 'astrbot',
        plugin: 'yuno-entry',
      },
      sender: context.sender || {},
    },
  };
}

export function createAstrBotYunoPlugin(options = {}) {
  const runConversation = options.runConversation || runYunoConversation;
  const router = options.router || createAstrBotPluginRouter({
    ...options,
    runConversation,
  });

  return {
    name: 'yuno-entry',
    async onMessage(context) {
      const input = adaptAstrBotMessage(context);
      const result = await router.route({
        ...context,
        input,
      });

      if (!result || result.suppressed || !result.response?.text) {
        return null;
      }

      return {
        plugin: result.plugin,
        text: result.response.text,
        outputs: result.response.outputs || [],
        voices: result.response.voices || [],
        analysis: result.analysis,
        event: result.event,
      };
    },
  };
}
