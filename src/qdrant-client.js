import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';

function getHeaders() {
  return config.qdrantApiKey
    ? { 'api-key': config.qdrantApiKey }
    : {};
}

function isConfigured() {
  return Boolean(config.qdrantUrl && config.qdrantCollection);
}

async function request(method, path, data = null, label = 'qdrant request') {
  if (!isConfigured()) {
    throw new Error('Qdrant is not configured');
  }

  const response = await withRetry(
    () => axios({
      method,
      url: `${config.qdrantUrl}${path}`,
      data,
      headers: getHeaders(),
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
  if (!isConfigured()) {
    return { enabled: false };
  }

  try {
    await request('put', `/collections/${config.qdrantCollection}`, {
      vectors: {
        size: vectorSize,
        distance: options.distance || 'Cosine',
      },
    }, 'ensure qdrant collection');
    return { enabled: true };
  } catch (error) {
    if (error.response?.status === 409) {
      return { enabled: true };
    }
    throw error;
  }
}

export async function upsertKnowledgePoints(points) {
  if (!isConfigured()) {
    return { enabled: false, count: 0 };
  }

  await request('put', `/collections/${config.qdrantCollection}/points?wait=true`, {
    points,
  }, 'upsert qdrant points');

  return { enabled: true, count: points.length };
}

export async function scrollKnowledgePoints(filter = null, limit = 256, offset = null) {
  if (!isConfigured()) {
    return { points: [], nextOffset: null };
  }

  const data = await request('post', `/collections/${config.qdrantCollection}/points/scroll`, {
    limit,
    offset,
    with_payload: true,
    with_vector: false,
    filter: filter || undefined,
  }, 'scroll qdrant points');

  return {
    points: data.result?.points || [],
    nextOffset: data.result?.next_page_offset || null,
  };
}

export async function deleteKnowledgePointsByIds(ids) {
  if (!isConfigured() || !ids.length) {
    return { enabled: isConfigured(), count: 0 };
  }

  await request('post', `/collections/${config.qdrantCollection}/points/delete?wait=true`, {
    points: ids,
  }, 'delete qdrant points by ids');

  return { enabled: true, count: ids.length };
}

export async function setKnowledgeManifest(manifest, vectorSize = 1) {
  if (!isConfigured()) {
    return { enabled: false };
  }

  await upsertKnowledgePoints([{
    id: 'knowledge_manifest',
    vector: Array.from({ length: vectorSize }, () => 0),
    payload: {
      type: 'manifest',
      ...manifest,
    },
  }]);

  return { enabled: true };
}

export async function searchKnowledge(vector, options = {}) {
  if (!isConfigured()) {
    return [];
  }

  const data = await request('post', `/collections/${config.qdrantCollection}/points/search`, {
    vector,
    limit: options.limit || config.qdrantTopK,
    with_payload: true,
    with_vector: false,
    score_threshold: options.scoreThreshold ?? config.qdrantMinScore,
    filter: options.filter || undefined,
  }, 'search qdrant points');

  return data.result || [];
}

export function getQdrantStatus() {
  return {
    enabled: isConfigured(),
    collection: config.qdrantCollection,
  };
}
