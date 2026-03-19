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

export async function searchKnowledge(vector, options = {}) {
  if (!isConfigured()) {
    return [];
  }

  const data = await request('post', `/collections/${config.qdrantCollection}/points/search`, {
    vector,
    limit: options.limit || 4,
    with_payload: true,
    with_vector: false,
    score_threshold: options.scoreThreshold ?? 0.2,
  }, 'search qdrant points');

  return data.result || [];
}

export function getQdrantStatus() {
  return {
    enabled: isConfigured(),
    collection: config.qdrantCollection,
  };
}
