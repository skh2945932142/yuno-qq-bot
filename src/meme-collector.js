import { config } from './config.js';
import { createMemeAsset, updateMemeAsset } from './meme-repository.js';
import { assessMemeSafety } from './meme-safety.js';

const MEME_SEMANTIC_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

function truncateText(text, limit = 120) {
  const normalized = String(text || '').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function inferSemanticTags(event, baseTags = []) {
  const text = String(event.rawText || event.text || '');
  const semanticTags = [...baseTags];
  if (/(哈哈|笑死|蚌埠住了|搞笑|乐)/i.test(text)) semanticTags.push('funny');
  if (/(委屈|难受|哭|伤心|心碎)/i.test(text)) semanticTags.push('sad');
  if (/(气死|无语|炸了|离谱)/i.test(text)) semanticTags.push('frustrated');
  if (/(可爱|喜欢|爱你|贴贴)/i.test(text)) semanticTags.push('affectionate');
  if (/(截图|聊天记录|名场面)/i.test(text)) semanticTags.push('conversation');
  return [...new Set(semanticTags)].slice(0, 8);
}

function inferUsageContext(event) {
  const text = String(event.rawText || event.text || '').trim();
  if (!text) {
    return event.chatType === 'group' ? 'group-reaction' : 'private-reaction';
  }
  if (/(回复|回怼|反击)/i.test(text)) return 'comeback';
  if (/(收藏|存一下|记一下)/i.test(text)) return 'save-reference';
  if (/(做成图|表情包)/i.test(text)) return 'meme-request';
  return event.chatType === 'group' ? 'group-reaction' : 'private-reaction';
}

function buildMemeCaption(event, semanticTags, ocrText = '') {
  const parts = [
    truncateText(event.text || event.rawText || '', 48),
    ocrText ? `OCR:${truncateText(ocrText, 36)}` : '',
    semanticTags.length ? `tags:${semanticTags.join('/')}` : '',
  ].filter(Boolean);
  return truncateText(parts.join(' | '), 120);
}

function buildEmbeddingSourceText({ quoteText, caption, semanticTags, usageContext, ocrText }) {
  return [
    quoteText || '',
    caption || '',
    usageContext || '',
    ocrText || '',
    ...(semanticTags || []),
  ].filter(Boolean).join(' | ');
}

function buildExpiresAt(now = new Date()) {
  return new Date(now.getTime() + MEME_SEMANTIC_TTL_MS);
}

export async function analyzeMemeAssetSemantics(asset, event, deps = {}, now = new Date()) {
  if (!asset) return null;
  const ocrText = deps.extractMemeOcr
    ? await deps.extractMemeOcr({ asset, event }).catch(() => '')
    : '';
  const baseTags = Array.isArray(asset.tags) ? asset.tags : inferTags(event);
  let semanticTags = inferSemanticTags(event, baseTags);
  let caption = buildMemeCaption(event, semanticTags, ocrText);

  if (deps.generateMemeCaption) {
    try {
      const generated = await deps.generateMemeCaption({ asset, event, ocrText });
      if (generated?.caption) {
        caption = truncateText(generated.caption, 120);
      }
      if (Array.isArray(generated?.semanticTags) && generated.semanticTags.length > 0) {
        semanticTags = [...new Set([...semanticTags, ...generated.semanticTags.map((item) => String(item || '').trim()).filter(Boolean)])].slice(0, 8);
      }
    } catch {
      // Ignore optional semantic enrichment failures.
    }
  }

  const usageContext = inferUsageContext(event);
  const updates = {
    ocrText,
    caption,
    semanticTags,
    usageContext,
    embeddingSourceText: buildEmbeddingSourceText({
      quoteText: asset.quoteText || event.text || event.rawText || '',
      caption,
      semanticTags,
      usageContext,
      ocrText,
    }),
    lastAnalyzedAt: now,
    expiresAt: buildExpiresAt(now),
  };

  const updated = await updateMemeAsset(asset.assetId, updates, deps);
  return updated || { ...asset, ...updates };
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
    caption: '',
    semanticTags: [],
    usageContext: '',
    embeddingSourceText: '',
    emotion: options.emotion || 'funny',
    safetyStatus: safety.safetyStatus,
  }, deps);

  const analyzedAsset = await analyzeMemeAssetSemantics(asset, event, deps).catch(() => asset);

  return {
    collected: true,
    safety,
    asset: analyzedAsset || asset,
  };
}
