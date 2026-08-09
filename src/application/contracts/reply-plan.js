function normalizeOutput(output = {}) {
  const type = String(output.type || '').trim();
  if (type === 'text') {
    const text = String(output.text || '').trim();
    return text ? Object.freeze({ type, text }) : null;
  }
  if (type === 'image' && output.image) {
    return Object.freeze({ type, image: output.image });
  }
  return null;
}

export function createReplyPlan({
  event,
  target = null,
  outputs = [],
  voice = null,
  deliveryKey = '',
  persistence = null,
  metadata = {},
} = {}) {
  const normalizedOutputs = (Array.isArray(outputs) ? outputs : [])
    .map(normalizeOutput)
    .filter(Boolean);

  return Object.freeze({
    event,
    target: Object.freeze({
      platform: String(target?.platform || event?.platform || 'qq'),
      chatType: String(target?.chatType || event?.chatType || 'group'),
      chatId: String(target?.chatId || event?.chatId || ''),
      ...(target?.quoteMessageId ? { quoteMessageId: String(target.quoteMessageId) } : {}),
    }),
    outputs: Object.freeze(normalizedOutputs),
    voice: voice && typeof voice === 'object'
      ? Object.freeze({
        shouldSend: Boolean(voice.shouldSend),
        text: String(voice.text || ''),
        audio: voice.audio || null,
      })
      : Object.freeze({ shouldSend: false, text: '', audio: null }),
    deliveryKey: String(deliveryKey || '').trim(),
    persistence,
    metadata: Object.freeze({ ...metadata }),
  });
}

export function hasReplyOutputs(plan) {
  return Boolean(plan?.outputs?.length) || Boolean(plan?.voice?.shouldSend && (plan.voice.text || plan.voice.audio));
}
