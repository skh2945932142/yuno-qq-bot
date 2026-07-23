import { ConversationState, History } from './models.js';
import { buildSessionKey } from './chat/session.js';

const RECENT_MESSAGE_LIMIT = 8;
const SUMMARY_CHAR_LIMIT = 1200;
const MESSAGE_SNIPPET_LIMIT = 96;
const DEFAULT_APPEND_ATTEMPTS = 5;

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
    styleMove: item.role === 'assistant' ? String(item.styleMove || '').trim() : '',
    edgeScore: item.role === 'assistant' ? Math.max(0, Number(item.edgeScore || 0)) : 0,
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
    revision: 0,
    lastSummarizedAt: null,
    updatedAt: new Date(),
  };
}

async function loadLegacyHistory(session, options = {}) {
  const historyModel = options.History || History;
  if (session.platform !== 'qq' || session.chatType !== 'group') {
    return null;
  }

  const historyDoc = await historyModel.findOne({
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

export async function getConversationState(session, options = {}) {
  const conversationModel = options.ConversationState || ConversationState;
  const sessionKey = buildSessionKey(session);
  const existing = await conversationModel.findOne({ sessionKey });

  if (existing) {
    return {
      ...buildConversationDefaults(session),
      ...existing.toObject(),
      messages: (existing.messages || []).map(normalizeMessage),
    };
  }

  const migrated = await loadLegacyHistory(session, options);
  return migrated || buildConversationDefaults(session);
}

function createConversationWriteConflict(sessionKey, cause = null) {
  const error = new Error(`Conversation state changed while appending: ${sessionKey}`);
  error.code = 'CONVERSATION_WRITE_CONFLICT';
  if (cause) error.cause = cause;
  return error;
}

function isConversationWriteConflict(error) {
  return error?.code === 'CONVERSATION_WRITE_CONFLICT' || Number(error?.code) === 11000;
}

export async function saveConversationState(session, state, options = {}) {
  const conversationModel = options.ConversationState || ConversationState;
  const compacted = compactConversationState(state);
  const sessionKey = buildSessionKey(session);
  const now = new Date();
  const expectedRevision = Math.max(0, Number(state.revision || 0));
  const filter = { sessionKey };

  if (options.requireRevision) {
    if (expectedRevision === 0) {
      filter.$or = [
        { revision: 0 },
        { revision: { $exists: false } },
      ];
    } else {
      filter.revision = expectedRevision;
    }
  }

  let updated;
  try {
    updated = await conversationModel.findOneAndUpdate(
      filter,
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
        $inc: { revision: 1 },
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    if (options.requireRevision && isConversationWriteConflict(error)) {
      throw createConversationWriteConflict(sessionKey, error);
    }
    throw error;
  }

  if (!updated) {
    throw createConversationWriteConflict(sessionKey);
  }

  return {
    ...buildConversationDefaults(session),
    ...updated.toObject(),
    revision: Number(updated.revision ?? expectedRevision + 1),
    messages: (updated.messages || []).map(normalizeMessage),
  };
}

export async function appendConversationMessages(session, messages, options = {}) {
  const normalizedMessages = messages.map(normalizeMessage).filter((item) => item.content);
  if (normalizedMessages.length === 0) {
    return getConversationState(session, options);
  }

  const maxAttempts = Math.max(1, Number(options.maxAttempts || DEFAULT_APPEND_ATTEMPTS));
  let lastConflict = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await getConversationState(session, options);
    try {
      return await saveConversationState(session, {
        ...current,
        messages: [...current.messages, ...normalizedMessages],
      }, {
        ...options,
        requireRevision: true,
      });
    } catch (error) {
      if (!isConversationWriteConflict(error)) {
        throw error;
      }
      lastConflict = error;
    }
  }

  throw lastConflict || createConversationWriteConflict(buildSessionKey(session));
}