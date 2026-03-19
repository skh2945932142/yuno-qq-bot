import { config } from '../config.js';
import { normalizeLegacyMessageEvent } from '../chat/session.js';
import { extractAtTargets, stripCqCodes } from '../utils.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

  if (payload.post_type !== 'message') {
    errors.push('post_type must be "message"');
  }

  const messageType = String(payload.message_type || '').trim().toLowerCase();
  if (!['group', 'private'].includes(messageType)) {
    errors.push('message_type must be "group" or "private"');
  }

  if (!payload.user_id) {
    errors.push('user_id is required');
  }

  if (messageType === 'group' && !payload.group_id) {
    errors.push('group_id is required');
  }

  if (typeof payload.raw_message !== 'string') {
    errors.push('raw_message must be a string');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const resolvedSelfId = payload.self_id
    ? String(payload.self_id)
    : (config.selfQq || '');
  const sender = isObject(payload.sender) ? payload.sender : {};
  const rawText = payload.raw_message;
  const mentionsBot = messageType === 'group'
    ? extractAtTargets(rawText).includes(resolvedSelfId)
    : false;

  return {
    ok: true,
    value: normalizeLegacyMessageEvent({
      platform: 'qq',
      chatType: messageType,
      chatId: String(messageType === 'group' ? payload.group_id : payload.user_id),
      userId: String(payload.user_id),
      userName: sender.card || sender.nickname || String(payload.user_id),
      messageId: String(payload.message_id || ''),
      replyTo: resolveReplyTo(payload),
      text: stripCqCodes(rawText),
      rawText,
      mentionsBot,
      attachments: extractAttachments(rawText),
      timestamp: Number(payload.time || Date.now()),
      source: {
        adapter: 'onebot',
        postType: payload.post_type,
        messageType,
        subType: String(payload.sub_type || ''),
      },
      selfId: resolvedSelfId,
      sender,
    }),
  };
}
