import { config } from '../config.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateGroupMessageEvent(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return { ok: false, errors: ['payload must be an object'] };
  }

  if (payload.post_type !== 'message') {
    errors.push('post_type must be "message"');
  }

  if (payload.message_type !== 'group') {
    errors.push('message_type must be "group"');
  }

  if (!payload.group_id) {
    errors.push('group_id is required');
  }

  if (!payload.user_id) {
    errors.push('user_id is required');
  }

  if (typeof payload.raw_message !== 'string') {
    errors.push('raw_message must be a string');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // self_id is required for direct-mention detection ([CQ:at,qq=BOT_QQ]).
  // Some NapCat versions omit the field. Fall back to SELF_QQ from config so
  // that '@由乃' is never silently ignored due to a missing self_id.
  const resolvedSelfId = payload.self_id
    ? String(payload.self_id)
    : (config.selfQq || '');

  return {
    ok: true,
    value: {
      ...payload,
      group_id: String(payload.group_id),
      user_id: String(payload.user_id),
      self_id: resolvedSelfId,
      raw_message: payload.raw_message,
      sender: isObject(payload.sender) ? payload.sender : {},
    },
  };
}
