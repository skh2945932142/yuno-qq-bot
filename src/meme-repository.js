import { randomUUID } from 'node:crypto';
import { MemeAsset } from './models.js';

function pickModel(deps = {}) {
  return deps.model || MemeAsset;
}

export async function createMemeAsset(input, deps = {}) {
  const model = pickModel(deps);
  const payload = {
    assetId: input.assetId || randomUUID(),
    platform: input.platform || 'qq',
    chatId: String(input.chatId || ''),
    userId: String(input.userId || ''),
    sourceMessageId: String(input.sourceMessageId || ''),
    type: input.type || 'image',
    origin: input.origin || 'upload',
    quoteText: input.quoteText || '',
    imageUrl: input.imageUrl || '',
    storagePath: input.storagePath || '',
    avatarUrl: input.avatarUrl || '',
    tags: Array.isArray(input.tags) ? input.tags : [],
    emotion: input.emotion || 'funny',
    safetyStatus: input.safetyStatus || 'safe',
    disabled: Boolean(input.disabled),
    createdAt: input.createdAt || new Date(),
    lastUsedAt: input.lastUsedAt || null,
    usageCount: Number(input.usageCount || 0),
  };

  if (typeof model.create === 'function') {
    return model.create(payload);
  }

  throw new Error('Meme repository model does not support create');
}

export async function findMemeAssets(filters = {}, deps = {}) {
  const model = pickModel(deps);
  const query = {
    chatId: String(filters.chatId || ''),
    disabled: false,
  };

  if (filters.userId) {
    query.userId = String(filters.userId);
  }

  if (filters.type) {
    query.type = filters.type;
  }

  if (filters.safetyStatus) {
    query.safetyStatus = filters.safetyStatus;
  }

  if (typeof model.find === 'function') {
    let cursor = model.find(query);
    if (filters.limit && typeof cursor.limit === 'function') {
      cursor = cursor.limit(filters.limit);
    }
    if (typeof cursor.sort === 'function') {
      cursor = cursor.sort({ createdAt: -1 });
    }
    return cursor;
  }

  throw new Error('Meme repository model does not support find');
}

export async function disableMemeAsset(assetId, deps = {}) {
  const model = pickModel(deps);
  if (typeof model.findOneAndUpdate === 'function') {
    return model.findOneAndUpdate(
      { assetId: String(assetId || '') },
      { $set: { disabled: true } },
      { new: true }
    );
  }

  throw new Error('Meme repository model does not support disable');
}

export async function recordMemeUsage(assetId, deps = {}) {
  const model = pickModel(deps);
  if (typeof model.findOneAndUpdate === 'function') {
    return model.findOneAndUpdate(
      { assetId: String(assetId || '') },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
      { new: true }
    );
  }

  throw new Error('Meme repository model does not support usage updates');
}
