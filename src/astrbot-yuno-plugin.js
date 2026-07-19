import { runYunoConversation } from './yuno-core.js';
import { createAstrBotPluginRouter } from './astrbot-plugin-router.js';
import { shouldBypassAstrBotCommand } from './astrbot-command-bypass.js';

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

export function extractYunoReplyPayload(result = {}) {
  if (!result || result.suppressed) {
    return null;
  }

  const response = result.response || {};
  const outputs = result.outputs || response.outputs || {};
  const texts = [];
  const legacyText = String(response.text || '').trim();
  if (legacyText) {
    texts.push(legacyText);
  }

  const replies = Array.isArray(outputs.replies) ? outputs.replies : [];
  for (const item of replies) {
    if (item?.type !== 'text') {
      continue;
    }
    const text = String(item.text || '').trim();
    if (text) {
      texts.push(text);
    }
  }

  const uniqueTexts = [...new Set(texts)];
  if (uniqueTexts.length === 0) {
    return null;
  }

  const structuredOutputs = Array.isArray(response.outputs) && response.outputs.length > 0
    ? response.outputs
    : Array.isArray(outputs.outputs) && outputs.outputs.length > 0
      ? outputs.outputs
      : replies;

  return {
    text: uniqueTexts.join('\n'),
    outputs: structuredOutputs,
    voices: Array.isArray(response.voices)
      ? response.voices
      : Array.isArray(outputs.voices)
        ? outputs.voices
        : [],
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
      if (shouldBypassAstrBotCommand(context)) {
        return null;
      }

      const input = adaptAstrBotMessage(context);
      const result = await router.route({
        ...context,
        input,
      });
      const reply = extractYunoReplyPayload(result);

      if (!reply) {
        return null;
      }

      return {
        plugin: result.plugin,
        text: reply.text,
        outputs: reply.outputs,
        voices: reply.voices,
        analysis: result.analysis,
        event: result.event,
      };
    },
  };
}
