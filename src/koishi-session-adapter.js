import { normalizeLegacyMessageEvent } from './chat/session.js';
import { stripCqCodes } from './utils.js';

const PRIVATE_CHANNEL_PREFIX = 'private:';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeElement(element = {}) {
  const attrs = element.attrs || element.data || {};
  return {
    type: String(element.type || element.name || '').toLowerCase(),
    attrs,
    children: asArray(element.children),
  };
}

function collectAttachments(elements = []) {
  const attachments = [];
  for (const rawElement of elements) {
    const element = normalizeElement(rawElement);
    const type = element.type;
    if (['image', 'img'].includes(type)) attachments.push({ type: 'image', data: { ...element.attrs } });
    if (['audio', 'record'].includes(type)) attachments.push({ type: 'record', data: { ...element.attrs } });
    if (type === 'video') attachments.push({ type: 'video', data: { ...element.attrs } });
    if (['file', 'attachment'].includes(type)) attachments.push({ type: 'file', data: { ...element.attrs } });
    if (['face', 'mface', 'emoji'].includes(type)) attachments.push({ type: 'face', data: { ...element.attrs } });
    attachments.push(...collectAttachments(element.children));
  }
  return attachments;
}

function collectText(elements = []) {
  return elements.flatMap((rawElement) => {
    const element = normalizeElement(rawElement);
    const ownText = element.type === 'text'
      ? String(element.attrs.content || element.attrs.text || '')
      : '';
    return [ownText, collectText(element.children)];
  }).join('');
}

function hasAtSelf(elements = [], selfId = '') {
  if (!selfId) return false;
  return elements.some((rawElement) => {
    const element = normalizeElement(rawElement);
    const id = String(element.attrs.id || element.attrs.qq || element.attrs.userId || '');
    return (element.type === 'at' && id === selfId) || hasAtSelf(element.children, selfId);
  });
}

function stripPrivateChannelPrefix(value = '') {
  const normalized = String(value || '').trim();
  return normalized.startsWith(PRIVATE_CHANNEL_PREFIX)
    ? normalized.slice(PRIVATE_CHANNEL_PREFIX.length)
    : normalized;
}

function resolveOnebotPayload(session = {}) {
  const attachedPayload = session.onebot || (session.event?._type === 'onebot' ? session.event._data : null);
  if (attachedPayload && typeof attachedPayload === 'object') return attachedPayload;
  if (typeof session.getInternal === 'function') {
    return session.getInternal('onebot') || {};
  }
  return session.internal?.onebot || session.event?.onebot || {};
}

function resolveNoticeText(session = {}, onebotPayload = {}) {
  const type = String(session.type || session.event?.type || '').toLowerCase();
  const noticeType = String(onebotPayload.notice_type || session.noticeType || session.event?.notice_type || '').toLowerCase();
  const subType = String(onebotPayload.sub_type || session.subtype || session.event?.sub_type || '').toLowerCase();
  if (type === 'notice' && subType === 'poke') return '/poke';
  if (noticeType === 'notify' && subType === 'poke') return '/poke';
  if (type === 'guild-member-added' || noticeType === 'group_increase') return '/welcome';
  return '';
}

function normalizeTimestamp(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now();
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

export function adaptKoishiSession(session = {}) {
  const onebotPayload = resolveOnebotPayload(session);
  const selfId = String(session.selfId || session.bot?.selfId || onebotPayload.self_id || '').trim();
  const userId = String(session.userId || session.author?.user?.id || session.author?.id || onebotPayload.user_id || '').trim();
  const groupId = String(session.guildId || session.channel?.guildId || onebotPayload.group_id || '').trim();
  const privateChat = Boolean(session.isDirect || session.subtype === 'private' || !groupId);
  const chatType = privateChat ? 'private' : 'group';
  const rawChannelId = String(session.channelId || session.channel?.id || '').trim();
  const chatId = stripPrivateChannelPrefix(chatType === 'group'
    ? (rawChannelId || groupId)
    : (rawChannelId || userId));
  const elements = asArray(session.elements || session.message?.elements);
  const content = String(session.content || session.message?.content || '');
  const noticeText = resolveNoticeText(session, onebotPayload);
  const rawText = noticeText || content;
  const targetId = String(onebotPayload.target_id || session.targetId || '').trim();
  const quote = session.quote || session.message?.quote || {};
  const quoteText = stripCqCodes(String(
    quote.content
    || quote.message?.content
    || collectText(asArray(quote.elements || quote.message?.elements))
    || ''
  ))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const quoteUserId = String(
    quote.user?.id
    || quote.author?.id
    || quote.userId
    || quote.user_id
    || ''
  ).trim();
  const quoteUserName = String(
    quote.member?.nick
    || quote.user?.nick
    || quote.user?.name
    || quote.author?.nick
    || quote.author?.name
    || ''
  ).trim();
  const mentionsBot = hasAtSelf(elements, selfId)
    || new RegExp(`<at[^>]+(?:id|qq)=['\"]${selfId}['\"]`, 'i').test(content)
    || (noticeText === '/poke' && Boolean(selfId) && targetId === selfId)
    || (Boolean(selfId) && Boolean(quoteUserId) && quoteUserId === selfId);
  const sender = {
    userId,
    nickname: session.username || session.author?.name || session.author?.user?.name || onebotPayload.sender?.nickname || userId,
    card: session.author?.nick || session.author?.member?.nick || onebotPayload.sender?.card || '',
  };
  const noticeType = onebotPayload.notice_type
    || (session.type === 'guild-member-added' ? 'group_increase' : '');

  return normalizeLegacyMessageEvent({
    platform: 'qq',
    chatType,
    chatId,
    userId,
    userName: sender.card || sender.nickname || userId,
    messageId: String(session.messageId || session.message?.id || session.id || onebotPayload.message_id || '').trim(),
    replyTo: String(quote.messageId || quote.id || quote.message_id || '').trim(),
    replyToText: quoteText,
    replyToUserId: quoteUserId,
    replyToUserName: quoteUserName,
    rawText,
    text: noticeText || stripCqCodes(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    mentionsBot,
    attachments: collectAttachments(elements),
    timestamp: normalizeTimestamp(session.timestamp || session.message?.timestamp || onebotPayload.time),
    selfId,
    sender,
    source: {
      adapter: 'koishi',
      transport: 'onebot',
      postType: String(onebotPayload.post_type || session.type || ''),
      messageType: String(onebotPayload.message_type || session.subtype || ''),
      noticeType,
      targetId,
      subType: String(onebotPayload.sub_type || session.subtype || ''),
      sessionType: String(session.type || ''),
    },
  });
}

export {
  PRIVATE_CHANNEL_PREFIX,
  collectAttachments,
  collectText,
  hasAtSelf,
  resolveNoticeText,
  resolveOnebotPayload,
  stripPrivateChannelPrefix,
};
