import { createHash } from 'node:crypto';
import path from 'node:path';
import axios from 'axios';
import { config } from './config.js';
import { isDbReady } from './db.js';
import { logger } from './logger.js';
import { MemeAsset } from './models.js';
import { withRetry } from './retry.js';

export const GLOBAL_MEME_CHAT_ID = '__global__';
export const MEME_PROVIDER_LOCAL_CACHE = 'local-cache';
export const MEME_PROVIDER_NAPCAT_FAVORITES = 'napcat-favorites';

const knownProviders = new Set([
  MEME_PROVIDER_LOCAL_CACHE,
  MEME_PROVIDER_NAPCAT_FAVORITES,
]);
const napcatFavoriteSyncState = new Map();

function normalizeProviderName(value) {
  const normalized = String(value || MEME_PROVIDER_LOCAL_CACHE).trim().toLowerCase();
  return knownProviders.has(normalized) ? normalized : MEME_PROVIDER_LOCAL_CACHE;
}

function normalizeLimit(value, fallback = 8) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(50, Math.max(1, Math.round(parsed)));
}

function normalizeNapcatCount(value, fallback = 48) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(200, Math.max(1, Math.round(parsed)));
}

function normalizeTtlMs(value, fallback = 60 * 60 * 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function normalizeStringList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,，;；\s]+/);
  return [...new Set(source
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
}

function hasImageSource(asset = {}) {
  return Boolean(String(asset.storagePath || asset.imageUrl || '').trim());
}

function isSendableAsset(asset = {}) {
  return asset
    && !asset.disabled
    && String(asset.safetyStatus || 'safe') === 'safe'
    && hasImageSource(asset);
}

async function resolveFindResult(cursor, limit) {
  let query = cursor;
  if (query && typeof query.sort === 'function') {
    query = query.sort({ createdAt: -1 });
  }
  if (query && typeof query.limit === 'function') {
    query = query.limit(limit);
  }
  if (query && typeof query.exec === 'function') {
    return query.exec();
  }
  return query;
}

function dedupeAssets(assets = [], limit = 8, allowedChatIds = null) {
  const seen = new Set();
  const allowed = Array.isArray(allowedChatIds)
    ? new Set(allowedChatIds.map((item) => String(item)))
    : null;
  const result = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    const assetId = String(asset?.assetId || '').trim();
    const assetChatId = String(asset?.chatId || '');
    if (
      !assetId
      || seen.has(assetId)
      || (allowed && !allowed.has(assetChatId))
      || !isSendableAsset(asset)
    ) {
      continue;
    }
    seen.add(assetId);
    result.push(asset);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

export function mergeMemeCandidates(...candidateLists) {
  return dedupeAssets(candidateLists.flatMap((list) => (Array.isArray(list) ? list : [])), 50);
}

export function resetMemeProviderState() {
  napcatFavoriteSyncState.clear();
}

function buildNapcatHeaders() {
  return config.napcatToken ? { Authorization: config.napcatToken } : {};
}

async function postNapcatAction(action, payload = {}, deps = {}) {
  if (typeof deps.postNapcat === 'function') {
    return deps.postNapcat(action, payload, `napcat ${action}`);
  }

  if (!config.napcatApi) {
    throw new Error('NAPCAT_API is not configured');
  }

  return withRetry(
    () => axios.post(`${config.napcatApi}/${action}`, payload, {
      headers: buildNapcatHeaders(),
      maxRedirects: 0,
      timeout: config.requestTimeoutMs,
    }),
    {
      retries: config.retryAttempts,
      delayMs: config.retryDelayMs,
      category: 'meme-provider',
      label: `napcat ${action}`,
      logger,
    }
  );
}

function findFirstArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  for (const key of ['data', 'items', 'list', 'faces', 'collections', 'result']) {
    const found = findFirstArray(value[key]);
    if (found.length > 0) {
      return found;
    }
  }

  return [];
}

function extractNapcatList(response) {
  return findFirstArray(response);
}

function pickFavoriteSource(item) {
  if (typeof item === 'string') {
    return item.trim();
  }

  if (!item || typeof item !== 'object') {
    return '';
  }

  const candidates = [
    item.file,
    item.url,
    item.path,
    item.uri,
    item.id,
    item.file_id,
    item.fileId,
    item.data?.file,
    item.data?.url,
    item.data?.path,
  ];
  return String(candidates.find((candidate) => String(candidate || '').trim()) || '').trim();
}

function normalizePathToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    if (/^https?:\/\//i.test(raw)) {
      return decodeURIComponent(new URL(raw).pathname);
    }
  } catch {
    return raw;
  }

  return raw.replace(/^file:\/\//i, '');
}

function deriveTagsFromFavorite(item, source) {
  const label = typeof item === 'object' && item
    ? String(item.name || item.text || item.label || item.emoji || '').trim()
    : '';
  const sourcePath = normalizePathToken(source);
  const sourceName = path.basename(sourcePath).replace(/\.[^.]+$/, '');
  return normalizeStringList([
    'qq-favorite',
    'napcat-favorite',
    label,
    ...String(sourceName || '').split(/[\\/_.\-\s()[\]{}]+/),
  ]);
}

function buildNapcatFavoriteAssetId(item, source) {
  if (item && typeof item === 'object') {
    const directId = String(item.md5 || item.file_md5 || item.fileMd5 || item.id || item.file_id || item.fileId || '').trim();
    if (directId) {
      return `napcatfav:${directId}`;
    }
  }

  const hash = createHash('sha256').update(String(source || '')).digest('hex');
  return `napcatfav:${hash}`;
}

function buildNapcatFavoritePayload(item, now = new Date()) {
  const source = pickFavoriteSource(item);
  if (!source) {
    return null;
  }

  const tags = deriveTagsFromFavorite(item, source);
  const sourceForStorage = source.replace(/^file:\/\//i, '');
  const isRemote = /^https?:\/\//i.test(sourceForStorage);
  const caption = tags.includes('qq-favorite')
    ? 'QQ favorite meme'
    : `QQ favorite meme: ${tags.join(', ')}`;
  const payload = {
    assetId: buildNapcatFavoriteAssetId(item, source),
    platform: 'qq',
    chatId: GLOBAL_MEME_CHAT_ID,
    userId: '',
    sourceMessageId: '',
    type: 'image',
    origin: 'napcat_favorite_cache',
    quoteText: '',
    imageUrl: isRemote ? sourceForStorage : '',
    storagePath: isRemote ? '' : sourceForStorage,
    avatarUrl: '',
    tags,
    ocrText: '',
    caption,
    semanticTags: tags,
    usageContext: 'qq-favorite-reaction',
    embeddingSourceText: [caption, 'qq-favorite-reaction', ...tags].join(' '),
    emotion: 'funny',
    safetyStatus: 'safe',
    lastUsedAt: null,
    lastAnalyzedAt: now,
    expiresAt: null,
  };
  return payload;
}

async function upsertNapcatFavoriteAsset(payload, model) {
  const updates = { ...payload };
  delete updates.disabled;
  delete updates.usageCount;
  delete updates.createdAt;

  if (typeof model.findOneAndUpdate === 'function') {
    return model.findOneAndUpdate(
      { assetId: payload.assetId },
      {
        $set: updates,
        $setOnInsert: {
          createdAt: new Date(),
          disabled: false,
          usageCount: 0,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  if (typeof model.findOne === 'function' && typeof model.create === 'function') {
    const existing = await model.findOne({ assetId: payload.assetId });
    if (existing) {
      Object.assign(existing, updates);
      return existing;
    }
    return model.create({
      ...payload,
      createdAt: new Date(),
      disabled: false,
      usageCount: 0,
    });
  }

  throw new Error('Meme provider model does not support favorite cache upsert');
}

async function fetchNapcatFavorites(count, deps = {}) {
  const customFaceResponse = await postNapcatAction('fetch_custom_face', { count }, deps);
  const customFaces = extractNapcatList(customFaceResponse);
  if (customFaces.length > 0) {
    return customFaces;
  }

  const collectionResponse = await postNapcatAction('get_collection_list', {}, deps);
  return extractNapcatList(collectionResponse);
}

export async function syncNapcatFavoriteMemeCache(options = {}, deps = {}) {
  const model = deps.model || deps.memeModel || MemeAsset;
  const hasInjectedModel = Boolean(deps.model || deps.memeModel);
  if (!hasInjectedModel && !isDbReady()) {
    return { enabled: false, reason: 'db-not-ready', count: 0 };
  }

  if (!model || typeof model.find !== 'function') {
    return { enabled: false, reason: 'model-not-supported', count: 0 };
  }

  const count = normalizeNapcatCount(options.count ?? deps.count ?? config.memeNapcatFavoritesCount, 48);
  const ttlMs = normalizeTtlMs(options.syncTtlMs ?? deps.syncTtlMs ?? config.memeNapcatFavoritesSyncTtlMs);
  const nowMs = Number(options.nowMs ?? deps.nowMs ?? Date.now());
  const syncKey = 'napcat-favorites';
  const current = napcatFavoriteSyncState.get(syncKey);
  if (!options.force && current && ttlMs > 0 && nowMs - current.syncedAt < ttlMs) {
    return { enabled: true, reason: 'fresh-cache', count: current.count };
  }

  let items = [];
  try {
    items = await fetchNapcatFavorites(count, deps);
  } catch (error) {
    logger.warn('meme', 'NapCat favorite meme sync failed', {
      message: error.message,
    });
    napcatFavoriteSyncState.set(syncKey, { syncedAt: nowMs, count: 0 });
    return { enabled: false, reason: 'napcat-failed', count: 0 };
  }

  const now = new Date(nowMs);
  let upserted = 0;
  for (const item of items) {
    const payload = buildNapcatFavoritePayload(item, now);
    if (!payload) {
      continue;
    }
    await upsertNapcatFavoriteAsset(payload, model);
    upserted += 1;
  }

  napcatFavoriteSyncState.set(syncKey, { syncedAt: nowMs, count: upserted });
  return { enabled: true, reason: 'synced', count: upserted };
}

export async function getLocalCacheMemeCandidates({
  chatId = '',
  limit = 8,
} = {}, deps = {}) {
  const model = deps.model || deps.memeModel || MemeAsset;
  const hasInjectedModel = Boolean(deps.model || deps.memeModel);
  if (!hasInjectedModel && !isDbReady()) {
    return [];
  }

  if (!model || typeof model.find !== 'function') {
    return [];
  }

  const normalizedChatId = String(chatId || '').trim();
  const chatIds = [...new Set([normalizedChatId, GLOBAL_MEME_CHAT_ID].filter(Boolean))];
  const safeLimit = normalizeLimit(limit);
  const query = {
    chatId: { $in: chatIds },
    disabled: false,
    safetyStatus: 'safe',
    type: 'image',
  };
  const found = await resolveFindResult(model.find(query), safeLimit * 2);
  return dedupeAssets(found, safeLimit, chatIds);
}

export async function getMemeCandidates({
  chatId = '',
  limit = 8,
  provider = '',
} = {}, deps = {}) {
  const providerName = normalizeProviderName(provider || deps.provider || config.memeProvider);
  if (providerName === MEME_PROVIDER_NAPCAT_FAVORITES) {
    await syncNapcatFavoriteMemeCache({
      count: deps.count ?? config.memeNapcatFavoritesCount,
      syncTtlMs: deps.syncTtlMs ?? config.memeNapcatFavoritesSyncTtlMs,
      nowMs: deps.nowMs,
    }, deps);
    return getLocalCacheMemeCandidates({ chatId, limit }, deps);
  }

  if (providerName === MEME_PROVIDER_LOCAL_CACHE) {
    return getLocalCacheMemeCandidates({ chatId, limit }, deps);
  }
  return [];
}
