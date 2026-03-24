import { parseCommand } from './command-parser.js';
import { findToolDefinitionByName } from './tool-config.js';
import { normalizeLegacyMessageEvent } from './chat/session.js';
import { stripCqCodes } from './utils.js';

const KNOWLEDGE_PATTERNS = [
  /设定/i,
  /规则/i,
  /世界观/i,
  /faq/i,
  /你是谁/i,
  /你会什么/i,
  /口癖/i,
  /人设/i,
  /手册/i,
  /文档/i,
];

const FOLLOW_UP_PATTERNS = [
  /^然后呢/i,
  /^继续/i,
  /^是吗/i,
  /^真的吗/i,
  /^那怎么办/i,
  /^为什么/i,
  /^怎么说/i,
];

const COLD_START_PATTERNS = [
  /无聊/i,
  /在吗/i,
  /不知道聊什么/i,
  /不知道聊啥/i,
  /聊点什么/i,
  /你会什么/i,
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
      toolArgs: {},
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
      reason: toolFailureFallback ? 'tool-fallback' : classifierCategory === 'info_query' ? 'classifier-info-query' : 'knowledge-pattern',
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
