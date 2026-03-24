import { parseMemeTrigger } from './meme-trigger.js';

export function decideMemeAction({
  event,
  analysis = {},
  candidates = [],
  safety = { allowed: true, safetyFlags: [] },
  autoSend = false,
} = {}) {
  const trigger = parseMemeTrigger(event?.rawText || event?.text || '');
  const hasImageAttachment = Array.isArray(event?.attachments) && event.attachments.some((item) => item.type === 'image');

  if (!safety.allowed) {
    return {
      action: 'skip',
      reason: 'unsafe',
      trigger,
    };
  }

  if (trigger.explicit && trigger.mode === 'generate-quote') {
    return {
      action: 'generate-quote',
      reason: 'explicit-generate',
      trigger,
    };
  }

  if (trigger.explicit && candidates.length > 0) {
    return {
      action: 'send-existing',
      reason: 'explicit-retrieve',
      candidate: candidates[0],
      trigger,
    };
  }

  if (hasImageAttachment) {
    return {
      action: 'collect',
      reason: 'image-attachment',
      trigger,
    };
  }

  if (autoSend && trigger.semiAuto && candidates.length > 0 && analysis.shouldRespond) {
    return {
      action: 'send-existing',
      reason: 'semi-auto',
      candidate: candidates[0],
      trigger,
    };
  }

  return {
    action: 'skip',
    reason: 'no-trigger',
    trigger,
  };
}
