import { buildReplyTarget } from './chat/session.js';
import { getRuntimeServices } from './runtime-services.js';

function resolveDeliveryAdapter(deps = {}) {
  const adapter = deps.deliveryAdapter || getRuntimeServices().deliveryAdapter;
  if (!adapter) {
    const error = new Error('YUNO_DELIVERY_UNAVAILABLE');
    error.code = 'YUNO_DELIVERY_UNAVAILABLE';
    throw error;
  }
  return adapter;
}

export function normalizeImageMessage(image) {
  if (!image) return null;
  if (typeof image === 'string') return { file: image };
  if (image.file || image.path || image.url || image.base64) return { ...image };
  return null;
}

export async function sendReplyWithDeps(target, text, deps = {}) {
  const adapter = resolveDeliveryAdapter(deps);
  return adapter.sendReply(buildReplyTarget(target), String(text || ''));
}

export async function sendReply(target, text) {
  return sendReplyWithDeps(target, text);
}

export async function sendStructuredReplyWithDeps(target, outputs = [], deps = {}) {
  const normalizedOutputs = outputs.filter((output) => {
    if (!output) return false;
    if (output.type === 'text') return Boolean(String(output.text || '').trim());
    if (output.type === 'image') return Boolean(normalizeImageMessage(output.image));
    return false;
  });
  if (normalizedOutputs.length === 0) return false;

  const adapter = resolveDeliveryAdapter(deps);
  return adapter.sendStructuredReply(buildReplyTarget(target), normalizedOutputs);
}

export async function sendStructuredReply(target, outputs = []) {
  return sendStructuredReplyWithDeps(target, outputs);
}

export async function sendImage(target, image) {
  return sendStructuredReply(target, [{ type: 'image', image }]);
}

export async function sendText(groupId, text, chatType = 'group') {
  return sendReply({ platform: 'qq', chatType, chatId: groupId }, text);
}

export async function sendVoiceWithDeps(target, audioBuffer, deps = {}) {
  if (!audioBuffer || audioBuffer.length === 0) return false;
  const adapter = resolveDeliveryAdapter(deps);
  return adapter.sendVoice(buildReplyTarget(target), audioBuffer);
}

export async function sendVoice(target, audioBuffer) {
  return sendVoiceWithDeps(target, audioBuffer);
}