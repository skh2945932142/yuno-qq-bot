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
