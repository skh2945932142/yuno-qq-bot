import { config } from '../config.js';
import { normalizeLegacyMessageEvent } from '../chat/session.js';
import { extractAtTargets, stripCqCodes } from '../utils.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOnebotMessageType(value, payload = {}) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['group'].includes(normalized)) return 'group';
  if (['private', 'friend', 'temp', 'direct'].includes(normalized)) return 'private';
  if (!normalized && payload.group_id) return 'group';
  if (!normalized) return 'private';
  return normalized;
}

function resolvePayloadUserId(payload) {
  return String(
    payload.user_id
      || payload.sender?.user_id
      || payload.sender?.userId
      || payload.user?.id
      || ''
  ).trim();
}

function isIgnorableSystemPayload(payload = {}) {
  const postType = String(payload.post_type || '').trim().toLowerCase();
  if (postType === 'meta_event') return true;
  if (postType === 'message_sent') return true;

  const noticeType = String(payload.notice_type || '').trim().toLowerCase();
  const metaEventType = String(payload.meta_event_type || '').trim().toLowerCase();
  const subType = String(payload.sub_type || payload.subtype || '').trim().toLowerCase();

  return [
    noticeType === 'client_status',
    noticeType === 'input_status',
    metaEventType === 'heartbeat',
    metaEventType === 'lifecycle',
    subType === 'heartbeat',
    subType === 'connect',
    subType === 'enable',
  ].some(Boolean);
}

function parseCqData(segment) {
  const data = {};

  for (const part of String(segment || '').split(',')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) continue;
    data[key] = value;
  }

  return data;
}

function extractAttachments(rawMessage) {
  const attachments = [];
  const message = String(rawMessage || '');

  for (const match of message.matchAll(/\[CQ:([^,\]]+)(?:,([^\]]*))?\]/g)) {
    const type = String(match[1] || '').trim();
    if (!type || ['at', 'reply', 'text'].includes(type)) {
      continue;
    }

    attachments.push({
      type,
      data: parseCqData(match[2] || ''),
    });
  }

  return attachments;
}

function resolveReplyTo(payload) {
  if (payload.reply && typeof payload.reply === 'object') {
    return String(payload.reply.message_id || payload.reply.id || '').trim();
  }

  const rawMessage = String(payload.raw_message || '');
  const match = rawMessage.match(/\[CQ:reply,id=([^\],]+)/);
  return match ? String(match[1] || '').trim() : '';
}

export function validateOnebotMessageEvent(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return { ok: false, errors: ['payload must be an object'] };
  }

  const postType = String(payload.post_type || '').trim().toLowerCase();
  const isMessage = postType === 'message';
  const isPoke = postType === 'notice'
    && String(payload.notice_type || '').trim().toLowerCase() === 'notify'
    && String(payload.sub_type || '').trim().toLowerCase() === 'poke';
  const isGroupIncrease = postType === 'notice'
    && String(payload.notice_type || '').trim().toLowerCase() === 'group_increase';

  if (!isMessage && !isPoke && !isGroupIncrease) {
    errors.push('payload must be a supported OneBot message or notice');
  }

  const messageType = normalizeOnebotMessageType(
    payload.message_type || payload.detail_type || '',
    payload
  );
  const inferredMessageType = isPoke || isGroupIncrease
    ? (payload.group_id ? 'group' : 'private')
    : messageType;
  const resolvedUserId = resolvePayloadUserId(payload);

  if (!['group', 'private'].includes(inferredMessageType)) {
    errors.push('message_type must be "group" or "private"');
  }

  if (!resolvedUserId) {
    errors.push('user_id is required');
  }

  if (inferredMessageType === 'group' && !payload.group_id) {
    errors.push('group_id is required');
  }

  if (isMessage && typeof payload.raw_message !== 'string') {
    errors.push('raw_message must be a string');
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      reason: isIgnorableSystemPayload(payload) ? 'system_payload' : 'invalid_payload',
      meta: {
        postType,
        messageType: inferredMessageType || '',
        noticeType: String(payload.notice_type || '').trim().toLowerCase(),
        metaEventType: String(payload.meta_event_type || '').trim().toLowerCase(),
        subType: String(payload.sub_type || payload.subtype || '').trim().toLowerCase(),
      },
    };
  }

  const resolvedSelfId = payload.self_id
    ? String(payload.self_id)
    : (config.selfQq || '');
  const sender = isObject(payload.sender) ? payload.sender : {};
  const rawText = isPoke
    ? '[poke]'
    : isGroupIncrease
      ? '[group_increase]'
      : payload.raw_message;
  const mentionsBot = isPoke
    ? String(payload.target_id || '') === resolvedSelfId
    : inferredMessageType === 'group'
      ? extractAtTargets(rawText).includes(resolvedSelfId)
      : false;
  const text = isPoke
    ? '/poke'
    : isGroupIncrease
      ? '/welcome'
      : stripCqCodes(rawText);

  return {
    ok: true,
    value: normalizeLegacyMessageEvent({
      platform: 'qq',
      chatType: inferredMessageType,
      chatId: String(inferredMessageType === 'group' ? payload.group_id : resolvedUserId),
      userId: resolvedUserId,
      userName: sender.card || sender.nickname || resolvedUserId,
      messageId: String(payload.message_id || ''),
      replyTo: resolveReplyTo(payload),
      text,
      rawText,
      mentionsBot,
      attachments: isMessage ? extractAttachments(rawText) : [],
      timestamp: Number(payload.time || Date.now()),
      source: {
        adapter: 'onebot',
        postType,
        messageType: inferredMessageType,
        noticeType: String(payload.notice_type || ''),
        subType: String(payload.sub_type || ''),
      },
      selfId: resolvedSelfId,
      sender,
    }),
  };
}
