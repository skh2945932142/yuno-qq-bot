import { createHash } from 'node:crypto';
import { MessageLog } from './models.js';
import { isDbReady } from './db.js';

function stableHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function normalizeAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .slice(0, 8)
    .map((item) => ({
      type: String(item?.type || ''),
      name: String(item?.name || item?.file || '').slice(0, 120),
      size: Number(item?.size || 0) || 0,
    }));
}

function asTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function buildInboundKey(event = {}) {
  const messageId = String(event.messageId || '').trim();
  if (messageId) return `in:${event.platform || 'qq'}:${event.chatId || ''}:${messageId}`;
  return `in:${stableHash([event.platform, event.chatId, event.userId, event.timestamp, event.rawText || event.text].join('|'))}`;
}

function buildOutboundKey(event = {}, deliveryKey = '', content = '') {
  const key = String(deliveryKey || '').trim();
  if (key) return `out:${key}`;
  return `out:${stableHash([event.platform, event.chatId, event.messageId, content, Date.now()].join('|'))}`;
}

async function upsertLog(payload, deps = {}) {
  if (!deps.model && !isDbReady()) return null;
  const model = deps.model || MessageLog;
  return model.findOneAndUpdate(
    { messageKey: payload.messageKey },
    { $setOnInsert: payload },
    { upsert: true, returnDocument: 'after' }
  );
}

export async function recordInboundMessageLog(event = {}, deps = {}) {
  const chatId = String(event.chatId || '').trim();
  if (!chatId) return null;
  return upsertLog({
    messageKey: buildInboundKey(event),
    platform: String(event.platform || 'qq'),
    chatType: String(event.chatType || 'group'),
    chatId,
    groupId: event.chatType === 'group' ? chatId : '',
    userId: String(event.userId || ''),
    role: 'user',
    messageId: String(event.messageId || ''),
    replyToMessageId: String(event.replyToMessageId || ''),
    content: String(event.rawText || event.text || ''),
    attachments: normalizeAttachments(event.attachments),
    createdAt: asTimestamp(event.timestamp),
  }, deps);
}

export async function recordOutboundMessageLog(event = {}, content = '', options = {}, deps = {}) {
  const chatId = String(event.chatId || '').trim();
  const text = String(content || '').trim();
  if (!chatId || !text) return null;
  return upsertLog({
    messageKey: buildOutboundKey(event, options.deliveryKey, text),
    platform: String(event.platform || 'qq'),
    chatType: String(event.chatType || 'group'),
    chatId,
    groupId: event.chatType === 'group' ? chatId : '',
    userId: String(event.selfId || ''),
    role: 'assistant',
    messageId: String(options.messageId || ''),
    replyToMessageId: String(event.messageId || ''),
    content: text,
    attachments: normalizeAttachments(options.attachments),
    deliveryKey: String(options.deliveryKey || ''),
    createdAt: asTimestamp(options.createdAt),
  }, deps);
}
