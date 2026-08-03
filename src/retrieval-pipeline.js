import { config } from './config.js';
import { recordWorkflowMetric } from './metrics.js';
import { getHybridQdrantStatus, searchHybridPoints, upsertHybridPoints } from './qdrant-client.js';
import { embedHybridTexts, isRetrievalGatewayConfigured, rerankHybridCandidates } from './retrieval-gateway.js';
import { hashRetrievalCacheKey, retrievalCache } from './retrieval-cache.js';

const RRF_K = 60;

function payloadText(payload = {}) {
  return String(
    payload.text
    || payload.fact
    || payload.summary
    || payload.caption
    || payload.humanReply
    || ''
  ).trim();
}

export function isHybridRetrievalEnabled(options = {}) {
  const runtimeConfig = options.config || config;
  if (options.forceEnabled === true) return true;
  return Boolean(
    runtimeConfig.retrievalHybridEnabled
    && getHybridQdrantStatus(options).enabled
    && isRetrievalGatewayConfigured(options)
  );
}

export function createHybridPoint({ id, embedding, payload = {} } = {}) {
  if (!id || !embedding?.dense) {
    throw new Error('Retrieval point requires id and a dense vector');
  }
  return {
    id,
    vector: {
      dense: embedding.dense,
      ...(embedding.sparse ? { lexical: embedding.sparse } : {}),
    },
    payload,
  };
}

export function fuseReciprocalRank(denseHits = [], lexicalHits = [], k = RRF_K) {
  const fused = new Map();
  const add = (hits, channel) => {
    hits.forEach((hit, index) => {
      const id = String(hit?.id ?? '');
      if (!id) return;
      const current = fused.get(id) || {
        ...hit,
        id: hit.id,
        score: 0,
        ranks: {},
      };
      current.score += 1 / (Number(k) + index + 1);
      current.ranks[channel] = index + 1;
      if (!current.payload && hit.payload) current.payload = hit.payload;
      fused.set(id, current);
    });
  };
  add(denseHits, 'dense');
  add(lexicalHits, 'lexical');
  return [...fused.values()].sort((left, right) => right.score - left.score);
}

async function embedQuery(query, deps = {}) {
  const runtimeConfig = deps.config || config;
  const cache = deps.cache || retrievalCache;
  const cacheKey = hashRetrievalCacheKey(['retrieval-query-vector/v2', runtimeConfig.retrievalProvider || 'gateway', runtimeConfig.retrievalEmbeddingModel, query]);
  const cached = await cache.get(cacheKey);
  if (cached?.dense) {
    recordWorkflowMetric('yuno_retrieval_cache_hit_total', 1, { source: 'query-vector' });
    return cached;
  }
  const embed = deps.embedHybridTexts || embedHybridTexts;
  const [embedding] = await embed([query], { task: 'query', config: runtimeConfig });
  await cache.set(cacheKey, embedding, runtimeConfig.retrievalVectorCacheTtlMs);
  return embedding;
}

function buildCandidateCacheKey(query, filter, options) {
  return hashRetrievalCacheKey([
    'retrieval-candidates/v2',
    query,
    filter,
    Number(options.candidateLimit),
    String(options.collection || config.qdrantHybridCollection),
    String(options.provider || config.retrievalProvider || 'gateway'),
  ]);
}

async function retrieveCandidates(query, embedding, filter, options, deps) {
  const runtimeConfig = deps.config || config;
  const cache = deps.cache || retrievalCache;
  const useCache = options.cacheKind === 'knowledge';
  const cacheKey = buildCandidateCacheKey(query, filter, options);
  if (useCache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      recordWorkflowMetric('yuno_retrieval_cache_hit_total', 1, { source: 'hybrid-candidates' });
      return cached;
    }
  }

  const search = deps.searchHybridPoints || searchHybridPoints;
  const result = await search({
    dense: embedding.dense,
    ...(embedding.sparse ? { lexical: embedding.sparse } : {}),
  }, {
    filter,
    limit: options.candidateLimit,
    collection: options.collection,
  });
  const fused = fuseReciprocalRank(result.dense, result.lexical).slice(0, options.rerankLimit);
  if (useCache) {
    await cache.set(cacheKey, fused, runtimeConfig.retrievalKnowledgeCacheTtlMs);
  }
  return fused;
}

async function rerankCandidates(query, candidates, options, deps) {
  const documents = candidates
    .map((item) => ({ id: String(item.id), text: payloadText(item.payload) }))
    .filter((item) => item.text);
  if (documents.length === 0) return candidates;

  try {
    const rerank = deps.rerankHybridCandidates || rerankHybridCandidates;
    const reranked = await rerank(query, documents, {
      topN: Math.min(documents.length, options.rerankLimit),
      config: deps.config || config,
    });
    const scores = new Map(reranked.map((item) => [String(item.id), Number(item.score)]));
    if (scores.size === 0) return candidates;
    recordWorkflowMetric('yuno_retrieval_rerank_total', 1, { result: 'success' });
    return [...candidates]
      .sort((left, right) => (scores.get(String(right.id)) ?? -Infinity) - (scores.get(String(left.id)) ?? -Infinity))
      .map((item) => ({ ...item, rerankScore: scores.get(String(item.id)) ?? null }));
  } catch {
    recordWorkflowMetric('yuno_retrieval_rerank_total', 1, { result: 'fallback' });
    return candidates;
  }
}

export async function retrieveHybridContext({
  query,
  filter,
  limit = 4,
  candidateLimit = null,
  rerankLimit = null,
  cacheKind = '',
  collection = '',
} = {}, deps = {}) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return { enabled: false, hits: [], reason: 'empty-query' };
  if (!isHybridRetrievalEnabled({ ...deps, collection })) {
    return { enabled: false, hits: [], reason: 'hybrid-not-configured' };
  }

  const runtimeConfig = deps.config || config;
  const options = {
    candidateLimit: Math.max(1, Number(candidateLimit || runtimeConfig.retrievalCandidateLimit || 20)),
    rerankLimit: Math.max(1, Number(rerankLimit || runtimeConfig.retrievalRerankLimit || 12)),
    provider: runtimeConfig.retrievalProvider || 'gateway',
    cacheKind,
    collection: collection || runtimeConfig.qdrantHybridCollection,
  };
  try {
    const embedding = await embedQuery(normalizedQuery, deps);
    const candidates = await retrieveCandidates(normalizedQuery, embedding, filter, options, deps);
    const ranked = await rerankCandidates(normalizedQuery, candidates, options, deps);
    const hits = ranked.slice(0, Math.max(1, Number(limit || 4)));
    recordWorkflowMetric('yuno_retrieval_hybrid_hits_total', hits.length, { cache_kind: cacheKind || 'none' });
    return { enabled: true, hits, reason: hits.length ? 'ok' : 'no-match', query: normalizedQuery };
  } catch (error) {
    recordWorkflowMetric('yuno_retrieval_hybrid_failures_total', 1, { cache_kind: cacheKind || 'none' });
    return { enabled: false, hits: [], reason: 'hybrid-retrieval-failed', error };
  }
}

export async function indexHybridDocuments(documents = [], deps = {}) {
  if (!Array.isArray(documents) || documents.length === 0) return { enabled: false, count: 0 };
  if (!isHybridRetrievalEnabled(deps)) return { enabled: false, count: 0 };
  const embed = deps.embedHybridTexts || embedHybridTexts;
  const embeddings = await embed(documents.map((item) => item.text), { task: 'document', config: deps.config || config });
  const points = documents.map((item, index) => createHybridPoint({
    id: item.id,
    embedding: embeddings[index],
    payload: item.payload,
  }));
  const upsert = deps.upsertHybridPoints || upsertHybridPoints;
  return upsert(points, { collection: deps.collection || (deps.config || config).qdrantHybridCollection });
}
