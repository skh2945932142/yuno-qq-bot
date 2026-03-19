import { parseCommand } from './services/commands.js';
import { mapCommandToTool } from './tools/query-tools.js';
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
  const tool = mapCommandToTool(command);

  if (tool) {
    return {
      type: 'tool',
      category: 'command',
      toolName: tool.name,
      toolArgs: tool.args,
      requiresModel: false,
      requiresRetrieval: false,
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

  if (matchAny(KNOWLEDGE_PATTERNS, normalizedText)) {
    return {
      type: 'chat',
      category: 'knowledge_qa',
      requiresModel: true,
      requiresRetrieval: true,
      allowFollowUp: normalizedEvent.chatType === 'private',
      reason: 'knowledge-pattern',
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
