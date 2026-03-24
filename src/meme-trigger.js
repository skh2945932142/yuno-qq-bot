export function parseMemeTrigger(text = '') {
  const normalized = String(text || '').trim();

  if (!normalized) {
    return { explicit: false, semiAuto: false, mode: 'none' };
  }

  if (/^\/meme\b/i.test(normalized) || /做成图|表情包/.test(normalized)) {
    return {
      explicit: true,
      semiAuto: true,
      mode: /做成图/.test(normalized) ? 'generate-quote' : 'send-existing',
    };
  }

  if (/破防|嘴硬|典中典|急了|乐子|哈哈/.test(normalized)) {
    return {
      explicit: false,
      semiAuto: true,
      mode: 'send-existing',
    };
  }

  return { explicit: false, semiAuto: false, mode: 'none' };
}
