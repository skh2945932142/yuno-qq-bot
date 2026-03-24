import { findMemeAssets, recordMemeUsage } from './meme-repository.js';

function extractQueryTags(text = '') {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,，。.!?？!/:]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreAsset(asset, tags = [], emotion = '') {
  let score = 0;
  const assetTags = Array.isArray(asset.tags) ? asset.tags.map((item) => String(item).toLowerCase()) : [];

  for (const tag of tags) {
    if (assetTags.includes(tag)) {
      score += 2;
    }
  }

  if (emotion && asset.emotion === emotion) {
    score += 1;
  }

  score += Math.min(Number(asset.usageCount || 0), 3) * 0.1;
  return score;
}

export async function searchMemeLibrary({
  chatId,
  userId = '',
  text = '',
  emotion = '',
  limit = 3,
}, deps = {}) {
  const assets = await findMemeAssets({ chatId, limit: Math.max(limit * 4, 8) }, deps);
  const tags = extractQueryTags(text);

  return assets
    .filter((asset) => !asset.disabled && (!userId || asset.userId === userId || !asset.userId))
    .map((asset) => ({
      asset,
      score: scoreAsset(asset, tags, emotion),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.asset);
}

export async function markMemeUsed(assetId, deps = {}) {
  return recordMemeUsage(assetId, deps);
}
