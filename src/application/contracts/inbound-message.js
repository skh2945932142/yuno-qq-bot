/**
 * Application-level representation of a message after adapter normalization.
 * Keep this contract transport-neutral: Koishi remains responsible for turning
 * a Session into this shape.
 */
export function createInboundMessage(event = {}) {
  const chatType = String(event.chatType || 'group').trim() === 'private' ? 'private' : 'group';
  const chatId = String(event.chatId || '').trim();
  const userId = String(event.userId || '').trim();

  if (!chatId) {
    throw new Error('INBOUND_MESSAGE_CHAT_ID_REQUIRED');
  }
  if (!userId) {
    throw new Error('INBOUND_MESSAGE_USER_ID_REQUIRED');
  }

  return Object.freeze({
    ...event,
    platform: String(event.platform || 'qq').trim() || 'qq',
    chatType,
    chatId,
    userId,
    userName: String(event.userName || userId).trim() || userId,
    messageId: String(event.messageId || '').trim(),
    rawText: String(event.rawText ?? event.text ?? ''),
    text: String(event.text ?? event.rawText ?? ''),
    attachments: Array.isArray(event.attachments) ? event.attachments : [],
    timestamp: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : Date.now(),
    source: event.source && typeof event.source === 'object' ? event.source : {},
    sender: event.sender && typeof event.sender === 'object' ? event.sender : {},
  });
}

export function isInboundMessage(value) {
  return Boolean(value)
    && typeof value === 'object'
    && Boolean(String(value.chatId || '').trim())
    && Boolean(String(value.userId || '').trim())
    && (value.chatType === 'private' || value.chatType === 'group');
}
