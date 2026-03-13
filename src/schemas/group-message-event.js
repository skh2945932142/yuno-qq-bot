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

  return {
    ok: true,
    value: {
      ...payload,
      group_id: String(payload.group_id),
      user_id: String(payload.user_id),
      self_id: payload.self_id ? String(payload.self_id) : '',
      raw_message: payload.raw_message,
      sender: isObject(payload.sender) ? payload.sender : {},
    },
  };
}
