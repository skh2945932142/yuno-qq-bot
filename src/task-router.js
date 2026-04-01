import { parseCommand } from './command-parser.js';
import { findToolDefinitionByName } from './tool-config.js';
import { normalizeLegacyMessageEvent } from './chat/session.js';
import { stripCqCodes } from './utils.js';

const KNOWLEDGE_PATTERNS = [
  /(设定|人设|规则|世界观|手册|文档|faq|说明书?)/i,
  /(你是谁|你会什么|你能做什么)/i,
  /(manual|docs?|documentation|faq|who are you|what can you do)/i,
];

const FOLLOW_UP_PATTERNS = [
  /^(然后呢|然后|接着|继续|展开说说|细说|再说说)/i,
  /^(是吗|真的吗|真的呢|后来呢)/i,
  /^(那怎么办|那然后呢|那为什么|为什么|怎么说|什么意思)/i,
  /^(and then|go on|continue|really\??|why|what do you mean)/i,
];

const COLD_START_PATTERNS = [
  /(无聊|在吗|不知道聊什么|聊点什么|说点什么|陪我聊聊)/i,
  /(你会什么|你能做什么|随便聊聊)/i,
  /(bored|you there|what should we talk about|say something)/i,
];

function matchAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

export function planIncomingTask({ event, text, analysis, conversationState }) {
  const normalizedEvent = normalizeLegacyMessageEvent(event);
  const rawText = String(text ?? normalizedEvent.rawText ?? '');
  const normalizedText = stripCqCodes(rawText);
  const command = parseCommand(rawText);

  if (command?.toolName) {
    const tool = findToolDefinitionByName(command.toolName);
    const allowedInChat = tool?.allowIn?.includes(normalizedEvent.chatType) ?? true;
    if (!allowedInChat) {
      return {
        type: 'ignore',
        category: 'ignore',
        requiresModel: false,
        requiresRetrieval: false,
        reason: 'tool-not-allowed-in-chat',
      };
    }

    return {
      type: 'tool',
      category: 'command',
      toolName: command.toolName,
      toolArgs: command.toolArgs || {},
      requiresModel: false,
      requiresRetrieval: false,
      command,
      toolMeta: tool,
      reason: `command:${command.type}`,
    };
  }

  if (!analysis.shouldRespond) {
    return {
      type: 'ignore',
      category: 'ignore',
      requiresModel: false,
      requiresRetrieval: false,
      reason: analysis.reason,
    };
  }

  if (analysis.reason === 'poke-trigger') {
    return {
      type: 'chat',
      category: 'poke',
      requiresModel: true,
      requiresRetrieval: false,
      allowFollowUp: false,
      reason: analysis.reason,
    };
  }

  const recentMessages = conversationState?.messages || [];
  const hasRecentContext = recentMessages.length >= 2 || Boolean(conversationState?.rollingSummary);
  const classifierCategory = analysis.decisionExplanation?.classifier?.category || '';
  const toolFailureFallback = analysis.reason === 'tool-fallback';

  if (matchAny(KNOWLEDGE_PATTERNS, normalizedText) || classifierCategory === 'info_query' || toolFailureFallback) {
    return {
      type: 'chat',
      category: 'knowledge_qa',
      requiresModel: true,
      requiresRetrieval: true,
      allowFollowUp: normalizedEvent.chatType === 'private',
      reason: toolFailureFallback
        ? 'tool-fallback'
        : classifierCategory === 'info_query'
          ? 'classifier-info-query'
          : 'knowledge-pattern',
    };
  }

  if (matchAny(COLD_START_PATTERNS, normalizedText)) {
    return {
      type: 'chat',
      category: 'cold_start',
      requiresModel: true,
      requiresRetrieval: false,
      allowFollowUp: true,
      reason: 'cold-start-pattern',
    };
  }

  if ((normalizedEvent.replyTo && hasRecentContext) || matchAny(FOLLOW_UP_PATTERNS, normalizedText)) {
    return {
      type: 'chat',
      category: 'follow_up',
      requiresModel: true,
      requiresRetrieval: false,
      allowFollowUp: normalizedEvent.chatType === 'private',
      reason: 'follow-up-pattern',
    };
  }

  return {
    type: 'chat',
    category: normalizedEvent.chatType === 'private' ? 'private_chat' : 'group_chat',
    requiresModel: true,
    requiresRetrieval: false,
    allowFollowUp: normalizedEvent.chatType === 'private',
    reason: analysis.reason,
  };
}
