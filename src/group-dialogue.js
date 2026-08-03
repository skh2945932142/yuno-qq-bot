import { createHash, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { GroupDialogueChunk } from './models.js';
import { isDbReady } from './db.js';
import { indexHybridDocuments, retrieveHybridContext } from './retrieval-pipeline.js';

function asDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function truncateText(value, limit = 600) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function pointId(chunkId) {
  const hash = createHash('sha256').update(`group-dialogue:${chunkId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function chunkPayload(chunk) {
  return {
    type: 'group_dialogue',
    scope: 'group',
    visibility: 'group',
    sourceId: String(chunk.chunkId),
    groupId: String(chunk.groupId),
    userId: String(chunk.userId),
    chatId: String(chunk.groupId),
    summary: String(chunk.summary),
    expiresAt: chunk.expiresAt instanceof Date ? chunk.expiresAt.toISOString() : String(chunk.expiresAt || ''),
  };
}

export async function appendGroupDialogueChunk(event = {}, deps = {}) {
  if (event.chatType !== 'group' || !event.chatId || !event.userId) return null;
  if (!deps.model && !isDbReady()) return null;
  const text = truncateText(event.rawText || event.text || '', 360);
  if (!text) return null;

  const runtimeConfig = deps.config || config;
  const model = deps.model || GroupDialogueChunk;
  const endAt = asDate(event.timestamp);
  const windowStart = new Date(endAt.getTime() - Math.max(1_000, Number(runtimeConfig.groupDialogueWindowMs || 180000)));
  const existing = await model.findOne({
    groupId: String(event.chatId),
    userId: String(event.userId),
    endAt: { $gte: windowStart },
  }).sort({ endAt: -1 });
  const existingValue = typeof existing?.toObject === 'function' ? existing.toObject() : existing;
  const sourceMessageIds = [...new Set([
    ...(existingValue?.sourceMessageIds || []),
    String(event.messageId || '').trim(),
  ].filter(Boolean))].slice(-24);
  const summaryParts = [
    existingValue?.summary,
    `${String(event.userName || event.userId || '群友').slice(0, 20)}: ${text}`,
  ].filter(Boolean);
  const summary = truncateText(summaryParts.join('\n'), 900);
  const expiresAt = new Date(endAt.getTime() + (Math.max(1, Number(runtimeConfig.messageLogRetentionDays || 30)) * 24 * 60 * 60 * 1000));
  const payload = {
    platform: String(event.platform || 'qq'),
    groupId: String(event.chatId),
    userId: String(event.userId),
    startAt: existingValue?.startAt || endAt,
    endAt,
    sourceMessageIds,
    summary,
    embeddingSourceText: summary,
    expiresAt,
  };
  const chunk = existingValue
    ? await model.findOneAndUpdate({ chunkId: existingValue.chunkId }, { $set: payload }, { returnDocument: 'after' })
    : await model.create({ chunkId: randomUUID(), ...payload });
  const normalized = typeof chunk?.toObject === 'function' ? chunk.toObject() : chunk;

  if (normalized && !deps.skipIndex) {
    await (deps.indexHybridDocuments || indexHybridDocuments)([{
      id: pointId(normalized.chunkId),
      text: normalized.embeddingSourceText,
      payload: chunkPayload(normalized),
    }], deps).catch(() => {});
  }
  return normalized;
}

export async function retrieveGroupDialogueContext({ groupId, query, limit = 2 } = {}, deps = {}) {
  const normalizedGroupId = String(groupId || '').trim();
  if (!normalizedGroupId || !String(query || '').trim()) return [];
  const result = await (deps.retrieveHybridContext || retrieveHybridContext)({
    query,
    limit,
    cacheKind: '',
    filter: {
      must: [
        { key: 'type', match: { value: 'group_dialogue' } },
        { key: 'scope', match: { value: 'group' } },
        { key: 'groupId', match: { value: normalizedGroupId } },
      ],
    },
  }, deps);
  return (result.hits || []).map((hit) => ({
    chunkId: String(hit.payload?.sourceId || ''),
    summary: String(hit.payload?.summary || ''),
    score: hit.rerankScore ?? hit.score,
  })).filter((item) => item.summary);
}
