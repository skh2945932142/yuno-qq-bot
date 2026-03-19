import { ConversationState, History } from './models.js';
import { buildSessionKey } from './chat/session.js';

const RECENT_MESSAGE_LIMIT = 8;
const SUMMARY_CHAR_LIMIT = 1200;
const MESSAGE_SNIPPET_LIMIT = 96;

function truncateText(text, limit = MESSAGE_SNIPPET_LIMIT) {
  const normalized = String(text || '').trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function summarizeMessages(messages) {
  return messages
    .map((item) => `${item.role === 'assistant' ? 'Bot' : 'User'}: ${truncateText(item.content)}`)
    .join(' | ');
}

function mergeRollingSummary(previousSummary, summarizedMessages) {
  const segment = summarizeMessages(summarizedMessages);
  const nextSummary = [String(previousSummary || '').trim(), segment]
    .filter(Boolean)
    .join(' || ');

  if (nextSummary.length <= SUMMARY_CHAR_LIMIT) {
    return nextSummary;
  }

  return nextSummary.slice(nextSummary.length - SUMMARY_CHAR_LIMIT);
}

function normalizeMessage(item) {
  return {
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: String(item.content || '').trim(),
    time: item.time ? new Date(item.time) : new Date(),
  };
}

export function compactConversationState(state, limit = RECENT_MESSAGE_LIMIT) {
  const messages = (state.messages || [])
    .map(normalizeMessage)
    .filter((item) => item.content);

  if (messages.length <= limit) {
    return {
      rollingSummary: String(state.rollingSummary || '').trim(),
      messages,
      summarizedCount: 0,
    };
  }

  const overflow = messages.length - limit;
  const summarizedMessages = messages.slice(0, overflow);

  return {
    rollingSummary: mergeRollingSummary(state.rollingSummary, summarizedMessages),
    messages: messages.slice(overflow),
    summarizedCount: summarizedMessages.length,
  };
}

function buildConversationDefaults(session) {
  return {
    platform: session.platform,
    chatType: session.chatType,
    chatId: session.chatId,
    sessionKey: buildSessionKey(session),
    userId: session.userId,
    rollingSummary: '',
    messages: [],
    lastSummarizedAt: null,
    updatedAt: new Date(),
  };
}

async function loadLegacyHistory(session) {
  if (session.platform !== 'qq' || session.chatType !== 'group') {
    return null;
  }

  const historyDoc = await History.findOne({
    groupId: String(session.chatId),
    userId: String(session.userId),
  });

  if (!historyDoc) {
    return null;
  }

  return {
    ...buildConversationDefaults(session),
    messages: (historyDoc.messages || []).map(normalizeMessage),
  };
}

export async function getConversationState(session) {
  const sessionKey = buildSessionKey(session);
  const existing = await ConversationState.findOne({ sessionKey });

  if (existing) {
    return {
      ...buildConversationDefaults(session),
      ...existing.toObject(),
      messages: (existing.messages || []).map(normalizeMessage),
    };
  }

  const migrated = await loadLegacyHistory(session);
  return migrated || buildConversationDefaults(session);
}

export async function saveConversationState(session, state) {
  const compacted = compactConversationState(state);
  const sessionKey = buildSessionKey(session);
  const now = new Date();

  const updated = await ConversationState.findOneAndUpdate(
    { sessionKey },
    {
      $set: {
        platform: session.platform,
        chatType: session.chatType,
        chatId: session.chatId,
        sessionKey,
        userId: session.userId,
        rollingSummary: compacted.rollingSummary,
        messages: compacted.messages,
        lastSummarizedAt: compacted.summarizedCount > 0 ? now : state.lastSummarizedAt || null,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return {
    ...buildConversationDefaults(session),
    ...updated.toObject(),
    messages: (updated.messages || []).map(normalizeMessage),
  };
}

export async function appendConversationMessages(session, messages) {
  const current = await getConversationState(session);
  return saveConversationState(session, {
    ...current,
    messages: [...current.messages, ...messages.map(normalizeMessage)],
  });
}
