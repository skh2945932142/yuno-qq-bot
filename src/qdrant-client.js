import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';

const KNOWLEDGE_MANIFEST_POINT_ID = '00000000-0000-5000-8000-000000000001';

function getHeaders(options = {}) {
  const apiKey = options.apiKey ?? config.qdrantApiKey;
  return apiKey
    ? { 'api-key': apiKey }
    : {};
}

function isConfigured(options = {}) {
  const url = options.url ?? config.qdrantUrl;
  const collection = options.collection ?? config.qdrantCollection;
  return Boolean(url && collection);
}

function extractVectorSize(collectionResult) {
  const vectorConfig = collectionResult?.config?.params?.vectors;
  if (typeof vectorConfig?.size === 'number') {
    return vectorConfig.size;
  }

  if (vectorConfig && typeof vectorConfig === 'object') {
    const firstVector = Object.values(vectorConfig)[0];
    if (typeof firstVector?.size === 'number') {
      return firstVector.size;
    }
  }

  return null;
}

async function request(method, path, data = null, label = 'qdrant request', options = {}) {
  const url = options.url ?? config.qdrantUrl;
  const httpClient = options.httpClient || axios;
  if (!isConfigured(options)) {
    throw new Error('Qdrant is not configured');
  }

  const response = await withRetry(
    () => httpClient({
      method,
      url: `${url}${path}`,
      data,
      headers: getHeaders(options),
      maxRedirects: 0,
      timeout: config.requestTimeoutMs,
    }),
    {
      retries: config.retryAttempts,
      delayMs: config.retryDelayMs,
      category: 'retrieval',
      label,
      logger,
    }
  );

  return response.data;
}

export async function ensureQdrantCollection(vectorSize, options = {}) {
  if (!isConfigured(options)) {
    return { enabled: false };
  }

  try {
    const existing = await request('get', `/collections/${options.collection ?? config.qdrantCollection}`, null, 'inspect qdrant collection', options);
    return {
      enabled: true,
      created: false,
      vectorSize: extractVectorSize(existing.result),
    };
  } catch (error) {
    if (error.response?.status !== 404) {
      throw error;
    }
  }

  try {
    await request('put', `/collections/${options.collection ?? config.qdrantCollection}`, {
      vectors: {
        size: vectorSize,
        distance: options.distance || 'Cosine',
      },
    }, 'ensure qdrant collection', options);
    return { enabled: true, created: true, vectorSize };
  } catch (error) {
    if (error.response?.status === 409) {
      const existing = await request('get', `/collections/${options.collection ?? config.qdrantCollection}`, null, 'inspect qdrant collection', options);
      return {
        enabled: true,
        created: false,
        vectorSize: extractVectorSize(existing.result),
      };
    }
    throw error;
  }
}

export async function upsertKnowledgePoints(points, options = {}) {
  if (!isConfigured(options)) {
    return { enabled: false, count: 0 };
  }

  await request('put', `/collections/${options.collection ?? config.qdrantCollection}/points?wait=true`, {
    points,
  }, 'upsert qdrant points', options);

  return { enabled: true, count: points.length };
}

export async function scrollKnowledgePoints(filter = null, limit = 256, offset = null, options = {}) {
  if (!isConfigured(options)) {
    return { points: [], nextOffset: null };
  }

  const data = await request('post', `/collections/${options.collection ?? config.qdrantCollection}/points/scroll`, {
    limit,
    offset,
    with_payload: true,
    with_vector: false,
    filter: filter || undefined,
  }, 'scroll qdrant points', options);

  return {
    points: data.result?.points || [],
    nextOffset: data.result?.next_page_offset || null,
  };
}

export async function deleteKnowledgePointsByIds(ids, options = {}) {
  if (!isConfigured(options) || !ids.length) {
    return { enabled: isConfigured(options), count: 0 };
  }

  await request('post', `/collections/${options.collection ?? config.qdrantCollection}/points/delete?wait=true`, {
    points: ids,
  }, 'delete qdrant points by ids', options);

  return { enabled: true, count: ids.length };
}

export async function setKnowledgeManifest(manifest, vectorSize = 1, options = {}) {
  if (!isConfigured(options)) {
    return { enabled: false };
  }

  await upsertKnowledgePoints([{
    id: KNOWLEDGE_MANIFEST_POINT_ID,
    vector: Array.from({ length: vectorSize }, () => 0),
    payload: {
      type: 'manifest',
      ...manifest,
    },
  }], options);

  return { enabled: true };
}

export async function searchKnowledge(vector, options = {}) {
  if (!isConfigured(options)) {
    return [];
  }

  const data = await request('post', `/collections/${options.collection ?? config.qdrantCollection}/points/search`, {
    vector,
    limit: options.limit || config.qdrantTopK,
    with_payload: true,
    with_vector: false,
    score_threshold: options.scoreThreshold ?? config.qdrantMinScore,
    filter: options.filter || undefined,
  }, 'search qdrant points', options);

  return data.result || [];
}

export function getQdrantStatus(options = {}) {
  return {
    enabled: isConfigured(options),
    collection: options.collection ?? config.qdrantCollection,
  };
}
function resolveHybridCollection(options = {}) {
  return String(options.collection ?? config.qdrantHybridCollection ?? '').trim();
}

function hybridOptions(options = {}) {
  return {
    ...options,
    collection: resolveHybridCollection(options),
  };
}

export function getHybridQdrantStatus(options = {}) {
  const collection = resolveHybridCollection(options);
  return {
    enabled: Boolean((options.url ?? config.qdrantUrl) && collection),
    collection,
  };
}

export async function ensureHybridQdrantCollection(vectorSize, options = {}) {
  const resolved = hybridOptions(options);
  if (!getHybridQdrantStatus(resolved).enabled) {
    return { enabled: false };
  }

  try {
    const existing = await request('get', `/collections/${resolved.collection}`, null, 'inspect hybrid qdrant collection', resolved);
    return {
      enabled: true,
      created: false,
      vectorSize: extractVectorSize(existing.result),
    };
  } catch (error) {
    if (error.response?.status !== 404) throw error;
  }

  await request('put', `/collections/${resolved.collection}`, {
    vectors: {
      dense: {
        size: Number(vectorSize),
        distance: options.distance || 'Cosine',
      },
    },
    sparse_vectors: {
      lexical: {},
    },
  }, 'create hybrid qdrant collection', resolved);
  return { enabled: true, created: true, vectorSize: Number(vectorSize) };
}

const HYBRID_PAYLOAD_INDEXES = [
  ['type', 'keyword'],
  ['scope', 'keyword'],
  ['userId', 'keyword'],
  ['chatId', 'keyword'],
  ['groupId', 'keyword'],
  ['visibility', 'keyword'],
  ['expiresAt', 'datetime'],
];

export async function ensureHybridPayloadIndexes(options = {}) {
  const resolved = hybridOptions(options);
  if (!getHybridQdrantStatus(resolved).enabled) return { enabled: false, count: 0 };

  for (const [fieldName, fieldSchema] of HYBRID_PAYLOAD_INDEXES) {
    try {
      await request('put', `/collections/${resolved.collection}/index`, {
        field_name: fieldName,
        field_schema: fieldSchema,
      }, 'ensure hybrid qdrant payload index', resolved);
    } catch (error) {
      // Qdrant returns a conflict when the index already exists. Treat it as
      // success so repeated startup/backfill calls remain idempotent.
      if (error.response?.status !== 409) throw error;
    }
  }
  return { enabled: true, count: HYBRID_PAYLOAD_INDEXES.length };
}

export async function upsertHybridPoints(points, options = {}) {
  const resolved = hybridOptions(options);
  if (!getHybridQdrantStatus(resolved).enabled) return { enabled: false, count: 0 };
  await request('put', `/collections/${resolved.collection}/points?wait=true`, {
    points,
  }, 'upsert hybrid qdrant points', resolved);
  return { enabled: true, count: points.length };
}

async function searchHybridVector(name, vector, options = {}) {
  const resolved = hybridOptions(options);
  if (!getHybridQdrantStatus(resolved).enabled) return [];
  const data = await request('post', `/collections/${resolved.collection}/points/search`, {
    vector: { name, vector },
    limit: options.limit || config.retrievalCandidateLimit || 20,
    with_payload: true,
    with_vector: false,
    score_threshold: options.scoreThreshold,
    filter: options.filter || undefined,
  }, `search hybrid qdrant ${name}`, resolved);
  return data.result || [];
}

export async function searchHybridPoints(vectors = {}, options = {}) {
  const dense = Array.isArray(vectors.dense) ? vectors.dense : null;
  const lexical = vectors.lexical || vectors.sparse || null;
  if (!dense || !lexical) return { dense: [], lexical: [] };
  const [denseHits, lexicalHits] = await Promise.all([
    searchHybridVector('dense', dense, options),
    searchHybridVector('lexical', lexical, options),
  ]);
  return { dense: denseHits, lexical: lexicalHits };
}
