import { config } from './config.js';
import { createMemeAsset } from './meme-repository.js';
import { assessMemeSafety } from './meme-safety.js';

function pickFirstImage(attachments = []) {
  return attachments.find((item) => item.type === 'image') || null;
}

function canCollectForEvent(event, options = {}) {
  const enabledGroups = options.memeEnabledGroups ?? config.memeEnabledGroups;
  const optOutUsers = options.memeOptOutUsers ?? config.memeOptOutUsers;

  if (!(options.memeEnabled ?? config.memeEnabled)) {
    return false;
  }

  if (!(options.memeAutoCollect ?? config.memeAutoCollect)) {
    return false;
  }

  if (Array.isArray(optOutUsers) && optOutUsers.includes(String(event.userId))) {
    return false;
  }

  if (Array.isArray(enabledGroups) && enabledGroups.length > 0 && !enabledGroups.includes(String(event.chatId))) {
    return false;
  }

  return true;
}

function inferTags(event) {
  const text = String(event.rawText || event.text || '');
  const tokens = text
    .toLowerCase()
    .split(/[\s,，。.!?？!/:]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(tokens.slice(0, 6))];
}

export async function collectMemeAssetForEvent(event, options = {}, deps = {}) {
  const imageAttachment = pickFirstImage(event.attachments || []);
  if (!imageAttachment || !canCollectForEvent(event, options)) {
    return null;
  }

  const safety = assessMemeSafety({
    text: event.rawText || event.text || '',
    attachments: event.attachments,
    username: event.userName,
  });

  if (!safety.allowed) {
    return {
      collected: false,
      safety,
      asset: null,
    };
  }

  const asset = await createMemeAsset({
    platform: event.platform,
    chatId: event.chatId,
    userId: event.userId,
    sourceMessageId: event.messageId,
    type: 'image',
    origin: 'upload',
    quoteText: event.text || '',
    imageUrl: imageAttachment.data?.url || imageAttachment.data?.file || '',
    storagePath: imageAttachment.data?.file || '',
    avatarUrl: event.sender?.avatar || '',
    tags: inferTags(event),
    emotion: options.emotion || 'funny',
    safetyStatus: safety.safetyStatus,
  }, deps);

  return {
    collected: true,
    safety,
    asset,
  };
}
