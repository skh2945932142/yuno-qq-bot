import { createEmbeddings } from './minimax.js';
import { config } from './config.js';
import { UserMemoryEvent, MemeAsset } from './models.js';
import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';
import { getRuntimeServices } from './runtime-services.js';
import { getQdrantStatus, searchKnowledge, upsertKnowledgePoints } from './qdrant-client.js';
import { isDbReady } from './db.js';

function buildPointId(prefix, value) {
  return `${prefix}:${String(value || '').trim()}`;
}

function normalizeEmbeddingRows(rows) {
  if (!Array.isArray(rows) || !rows[0]?.embedding || !Array.isArray(rows[0].embedding)) {
    throw new Error('Embedding provider returned invalid memory retrieval vectors');
  }
  return rows[0].embedding;
}

function isQdrantReady(deps = {}) {
  if (deps.upsertPoints || deps.searchPoints) {
    return true;
  }
  const configured = getQdrantStatus();
  const readiness = getRuntimeServices().readiness?.qdrant;
  return configured.enabled && !(readiness?.enabled && readiness.ready === false);
}

function safeDateString(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function mapMemoryEventToPoint(memoryEvent, vector) {
  return {
    id: buildPointId('memory_event', memoryEvent.memoryId),
    vector,
    payload: {
      type: 'memory_event',
      memoryId: memoryEvent.memoryId,
      userId: String(memoryEvent.userId || ''),
      chatId: String(memoryEvent.chatId || ''),
      groupId: String(memoryEvent.groupId || ''),
      eventType: memoryEvent.eventType || '',
      summary: memoryEvent.summary || '',
      tags: memoryEvent.tags || [],
      importanceScore: Number(memoryEvent.importanceScore || 0),
      expiresAt: safeDateString(memoryEvent.expiresAt),
    },
  };
}

function mapMemeAssetToPoint(asset, vector) {
  return {
    id: buildPointId('meme_semantic', asset.assetId),
    vector,
    payload: {
      type: 'meme_semantic',
      assetId: asset.assetId,
      userId: String(asset.userId || ''),
      chatId: String(asset.chatId || ''),
      semanticTags: asset.semanticTags || [],
      caption: asset.caption || '',
      usageContext: asset.usageContext || '',
      expiresAt: safeDateString(asset.expiresAt),
    },
  };
}

async function embedText(text, deps = {}) {
  const rows = await (deps.createEmbeddings || createEmbeddings)([text], {
    model: deps.embeddingModel || config.embeddingModel,
    operation: deps.operation || 'memory-embedding',
  });
  return normalizeEmbeddingRows(rows);
}

function activeFilter(now = new Date()) {
  return (item) => {
    if (!item) return false;
    if (!item.expiresAt) return true;
    const expiresAt = new Date(item.expiresAt);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt > now;
  };
}

export async function indexUserMemoryEvents(memoryEvents = [], deps = {}) {
  if (!Array.isArray(memoryEvents) || memoryEvents.length === 0 || !isQdrantReady(deps)) {
    return { enabled: false, count: 0 };
  }

  const points = [];
  for (const memoryEvent of memoryEvents) {
    const text = String(memoryEvent.embeddingSourceText || '').trim();
    if (!text) continue;
    const vector = await embedText(text, {
      ...deps,
      operation: 'memory-event-embedding',
    });
    points.push(mapMemoryEventToPoint(memoryEvent, vector));
  }

  if (!points.length) {
    return { enabled: false, count: 0 };
  }

  await (deps.upsertPoints || upsertKnowledgePoints)(points);
  recordWorkflowMetric('yuno_memory_vectors_upserted_total', points.length, { type: 'memory_event' });
  return { enabled: true, count: points.length };
}

export async function indexMemeAssetSemantics(asset, deps = {}) {
  if (!asset || !String(asset.embeddingSourceText || '').trim() || !isQdrantReady(deps)) {
    return { enabled: false, count: 0 };
  }

  const vector = await embedText(asset.embeddingSourceText, {
    ...deps,
    operation: 'meme-semantic-embedding',
  });
  await (deps.upsertPoints || upsertKnowledgePoints)([
    mapMemeAssetToPoint(asset, vector),
  ]);
  recordWorkflowMetric('yuno_memory_vectors_upserted_total', 1, { type: 'meme_semantic' });
  return { enabled: true, count: 1 };
}

async function searchSemanticPoints(query, filter, deps = {}) {
  if (!query || !isQdrantReady(deps)) {
    return [];
  }
  const vector = await embedText(query, {
    ...deps,
    operation: 'memory-retrieval-embedding',
  });
  return (deps.searchPoints || searchKnowledge)(vector, {
    limit: deps.limit || 4,
    scoreThreshold: deps.scoreThreshold ?? Math.max(0.18, config.qdrantMinScore),
    filter,
  });
}

export async function retrieveMemoryContext({ userId, userTurn, limitEvents = 3, limitMemes = 2, now = new Date() } = {}, deps = {}) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId || !String(userTurn || '').trim()) {
    return { eventMemories: [], memeMemories: [] };
  }
  if (!deps.memoryModel && !deps.memeModel && !isDbReady()) {
    return { eventMemories: [], memeMemories: [] };
  }

  try {
    const [eventHits, memeHits] = await Promise.all([
      searchSemanticPoints(userTurn, {
        must: [
          { key: 'type', match: { value: 'memory_event' } },
          { key: 'userId', match: { value: normalizedUserId } },
        ],
      }, { ...deps, limit: limitEvents }),
      searchSemanticPoints(userTurn, {
        must: [
          { key: 'type', match: { value: 'meme_semantic' } },
          { key: 'userId', match: { value: normalizedUserId } },
        ],
      }, { ...deps, limit: limitMemes }),
    ]);

    const memoryIds = eventHits.map((item) => String(item.payload?.memoryId || '')).filter(Boolean);
    const assetIds = memeHits.map((item) => String(item.payload?.assetId || '')).filter(Boolean);
    const memoryModel = deps.memoryModel || UserMemoryEvent;
    const memeModel = deps.memeModel || MemeAsset;
    const [memoryDocs, memeDocs] = await Promise.all([
      memoryIds.length ? memoryModel.find({ memoryId: { $in: memoryIds } }) : Promise.resolve([]),
      assetIds.length ? memeModel.find({ assetId: { $in: assetIds }, disabled: false }) : Promise.resolve([]),
    ]);

    const keepActive = activeFilter(now);
    const memoryMap = new Map(memoryDocs.filter(keepActive).map((item) => [String(item.memoryId), item]));
    const memeMap = new Map(memeDocs.filter(keepActive).map((item) => [String(item.assetId), item]));

    const eventMemories = memoryIds
      .map((id) => memoryMap.get(id))
      .filter(Boolean)
      .slice(0, limitEvents);
    const memeMemories = assetIds
      .map((id) => memeMap.get(id))
      .filter(Boolean)
      .slice(0, limitMemes);

    return { eventMemories, memeMemories };
  } catch (error) {
    logger.warn('retrieval', 'Memory retrieval failed', {
      message: error.message,
      userId: normalizedUserId,
    });
    recordWorkflowMetric('yuno_memory_retrieval_failures_total', 1, { type: 'context' });
    return { eventMemories: [], memeMemories: [] };
  }
}
