const DEFAULT_PLATFORM = 'qq';

export function normalizePlatform(value) {
  return String(value || DEFAULT_PLATFORM).trim().toLowerCase() || DEFAULT_PLATFORM;
}

export function normalizeChatType(value) {
  return String(value || 'group').trim().toLowerCase() === 'private' ? 'private' : 'group';
}

export function buildChatScopeId({ platform = DEFAULT_PLATFORM, chatType = 'group', chatId }) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedChatType = normalizeChatType(chatType);
  const normalizedChatId = String(chatId || '').trim();

  if (!normalizedChatId) {
    return '';
  }

  return normalizedChatType === 'group'
    ? normalizedChatId
    : `${normalizedPlatform}:private:${normalizedChatId}`;
}

export function buildSessionKey({ platform = DEFAULT_PLATFORM, chatType = 'group', chatId, userId }) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedChatType = normalizeChatType(chatType);
  const normalizedChatId = String(chatId || '').trim();
  const normalizedUserId = String(userId || '').trim();

  return `${normalizedPlatform}:${normalizedChatType}:${normalizedChatId}:${normalizedUserId}`;
}

export function buildUserProfileKey({ platform = DEFAULT_PLATFORM, userId }) {
  return `${normalizePlatform(platform)}:${String(userId || '').trim()}`;
}

export function buildReplyTarget(target, chatType = 'group') {
  if (target && typeof target === 'object') {
    return {
      platform: normalizePlatform(target.platform),
      chatType: normalizeChatType(target.chatType),
      chatId: String(target.chatId || '').trim(),
    };
  }

  return {
    platform: DEFAULT_PLATFORM,
    chatType: normalizeChatType(chatType),
    chatId: String(target || '').trim(),
  };
}

export function isUnifiedMessageEvent(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.platform
    && value.chatType
    && value.chatId
    && value.userId
    && typeof value.rawText === 'string'
  );
}

export function normalizeLegacyMessageEvent(event = {}) {
  if (isUnifiedMessageEvent(event)) {
    return event;
  }

  const chatType = normalizeChatType(event.chatType || event.message_type || (event.group_id ? 'group' : 'private'));
  const chatId = String(
    event.chatId
      || (chatType === 'group' ? event.group_id : event.user_id)
      || ''
  ).trim();
  const userId = String(event.userId || event.user_id || '').trim();
  const rawText = typeof event.rawText === 'string'
    ? event.rawText
    : String(event.raw_message || '');
  const userName = event.userName
    || event.sender?.card
    || event.sender?.nickname
    || userId
    || 'user';

  return {
    platform: normalizePlatform(event.platform),
    chatType,
    chatId,
    userId,
    userName,
    messageId: String(event.messageId || event.message_id || '').trim(),
    replyTo: String(event.replyTo || event.reply_to || '').trim(),
    text: typeof event.text === 'string' ? event.text : rawText,
    rawText,
    mentionsBot: Boolean(event.mentionsBot),
    attachments: Array.isArray(event.attachments) ? event.attachments : [],
    timestamp: Number.isFinite(event.timestamp) ? event.timestamp : Number(event.time || Date.now()),
    source: event.source || {},
    selfId: String(event.selfId || event.self_id || '').trim(),
    sender: event.sender || {},
  };
}
