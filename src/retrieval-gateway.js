import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';
import { withRetry } from './retry.js';

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveRetrievalProvider(value) {
  return String(value || 'gateway').trim().toLowerCase() === 'siliconflow'
    ? 'siliconflow'
    : 'gateway';
}

function resolveRuntime(options = {}) {
  const runtimeConfig = options.config || config;
  const provider = resolveRetrievalProvider(options.provider ?? runtimeConfig.retrievalProvider);
  const usesSiliconFlow = provider === 'siliconflow';
  return {
    provider,
    url: normalizeUrl(options.url ?? (usesSiliconFlow ? runtimeConfig.embeddingBaseUrl : runtimeConfig.retrievalGatewayUrl)),
    apiKey: String(options.apiKey ?? (usesSiliconFlow ? runtimeConfig.embeddingApiKey : runtimeConfig.retrievalGatewayApiKey) ?? '').trim(),
    embeddingModel: String(options.embeddingModel ?? runtimeConfig.retrievalEmbeddingModel ?? runtimeConfig.embeddingModel ?? '').trim(),
    rerankModel: String(options.rerankModel ?? runtimeConfig.retrievalRerankModel ?? '').trim(),
    embeddingTimeoutMs: Math.max(200, Number(options.embeddingTimeoutMs ?? runtimeConfig.retrievalGatewayTimeoutMs ?? 1800)),
    rerankTimeoutMs: Math.max(200, Number(options.rerankTimeoutMs ?? runtimeConfig.retrievalRerankTimeoutMs ?? 1800)),
    httpClient: options.httpClient || axios,
  };
}

export function getRetrievalProviderStatus(options = {}) {
  const runtime = resolveRuntime(options);
  const missing = [];
  if (!runtime.url) {
    missing.push(runtime.provider === 'siliconflow' ? 'EMBEDDING_BASE_URL' : 'RETRIEVAL_GATEWAY_URL');
  }
  if (!runtime.embeddingModel) missing.push('RETRIEVAL_GATEWAY_EMBED_MODEL');
  if (!runtime.rerankModel) missing.push('RETRIEVAL_RERANK_MODEL');
  if (runtime.provider === 'siliconflow' && !runtime.apiKey) {
    missing.push('EMBEDDING_API_KEY');
  }
  return {
    provider: runtime.provider,
    supportsSparse: runtime.provider === 'gateway',
    configured: missing.length === 0,
    missing,
  };
}

export function isRetrievalGatewayConfigured(options = {}) {
  return getRetrievalProviderStatus(options).configured;
}

function buildHeaders(runtime) {
  return runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {};
}

async function requestGateway(path, payload, timeoutMs, operation, options = {}) {
  const runtime = resolveRuntime(options);
  const providerStatus = getRetrievalProviderStatus(options);
  if (!providerStatus.configured) {
    throw new Error(`Retrieval provider is not configured: ${providerStatus.missing.join(', ')}`);
  }

  const startedAt = Date.now();
  try {
    const response = await withRetry(
      () => runtime.httpClient.post(`${runtime.url}${path}`, payload, {
        headers: buildHeaders(runtime),
        timeout: timeoutMs,
        maxRedirects: 0,
      }),
      {
        retries: options.retries ?? 0,
        delayMs: 100,
        category: 'retrieval',
        label: operation,
        logger,
      }
    );
    recordWorkflowMetric('yuno_retrieval_gateway_requests_total', 1, {
      operation,
      result: 'success',
      provider: runtime.provider,
    });
    recordWorkflowMetric('yuno_retrieval_gateway_duration_ms', Date.now() - startedAt, {
      operation,
      result: 'success',
      provider: runtime.provider,
    }, 'histogram');
    return response.data;
  } catch (error) {
    recordWorkflowMetric('yuno_retrieval_gateway_requests_total', 1, {
      operation,
      result: 'error',
      provider: runtime.provider,
    });
    recordWorkflowMetric('yuno_retrieval_gateway_duration_ms', Date.now() - startedAt, {
      operation,
      result: 'error',
      provider: runtime.provider,
    }, 'histogram');
    throw error;
  }
}

function normalizeDense(value) {
  const dense = Array.isArray(value) ? value : [];
  if (dense.length === 0 || dense.some((item) => !Number.isFinite(Number(item)))) {
    return null;
  }
  return dense.map(Number);
}

function normalizeSparse(value) {
  const indices = Array.isArray(value?.indices) ? value.indices : [];
  const values = Array.isArray(value?.values) ? value.values : [];
  if (indices.length === 0 || indices.length !== values.length) return null;
  if (indices.some((item) => !Number.isInteger(Number(item)) || Number(item) < 0)) return null;
  if (values.some((item) => !Number.isFinite(Number(item)))) return null;
  return {
    indices: indices.map(Number),
    values: values.map(Number),
  };
}

function normalizeEmbeddingItem(item, index, options = {}) {
  const dense = normalizeDense(item?.dense || item?.embedding || item?.vector);
  const sparse = normalizeSparse(item?.sparse || item?.lexical);
  if (!dense || (options.requireSparse && !sparse)) {
    throw new Error(`Retrieval provider returned invalid ${options.requireSparse ? 'hybrid' : 'dense'} embedding at index ${index}`);
  }
  return {
    id: String(item?.id ?? index),
    dense,
    ...(sparse ? { sparse } : {}),
  };
}

function readItems(data) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

export async function embedHybridTexts(texts, options = {}) {
  const normalizedTexts = (Array.isArray(texts) ? texts : [texts])
    .map((text) => String(text || '').trim())
    .filter(Boolean);
  if (normalizedTexts.length === 0) return [];

  const runtime = resolveRuntime(options);
  const usesSiliconFlow = runtime.provider === 'siliconflow';
  const data = await requestGateway(usesSiliconFlow ? '/embeddings' : '/v1/embed', usesSiliconFlow
    ? {
      model: runtime.embeddingModel,
      input: normalizedTexts,
      encoding_format: 'float',
    }
    : {
      model: runtime.embeddingModel,
      task: options.task || 'query',
      inputs: normalizedTexts.map((text, index) => ({ id: String(index), text })),
    }, runtime.embeddingTimeoutMs, 'embed', options);
  const items = readItems(data).map((item, index) => normalizeEmbeddingItem(item, index, { requireSparse: !usesSiliconFlow }));
  if (items.length !== normalizedTexts.length) {
    throw new Error(`Retrieval provider returned ${items.length} embeddings for ${normalizedTexts.length} inputs`);
  }
  return items;
}

function normalizeRerankItem(item, index) {
  const score = Number(item?.score ?? item?.relevance_score);
  if (!Number.isFinite(score)) {
    throw new Error(`Retrieval Gateway returned invalid rerank score at index ${index}`);
  }
  return {
    id: String(item?.id ?? item?.index ?? index),
    score,
  };
}

export async function rerankHybridCandidates(query, documents = [], options = {}) {
  const normalizedQuery = String(query || '').trim();
  const normalizedDocuments = (documents || [])
    .map((item, index) => ({
      id: String(item?.id ?? index),
      text: String(item?.text || '').trim(),
    }))
    .filter((item) => item.text);
  if (!normalizedQuery || normalizedDocuments.length === 0) return [];

  const runtime = resolveRuntime(options);
  const topN = Math.min(normalizedDocuments.length, Math.max(1, Number(options.topN || normalizedDocuments.length)));
  const usesSiliconFlow = runtime.provider === 'siliconflow';
  const data = await requestGateway(usesSiliconFlow ? '/rerank' : '/v1/rerank', usesSiliconFlow
    ? {
      model: runtime.rerankModel,
      query: normalizedQuery,
      documents: normalizedDocuments.map((item) => item.text),
      top_n: topN,
    }
    : {
      model: runtime.rerankModel,
      query: normalizedQuery,
      documents: normalizedDocuments,
      topN,
    }, runtime.rerankTimeoutMs, 'rerank', options);
  if (usesSiliconFlow) {
    const rows = Array.isArray(data?.results) ? data.results : readItems(data);
    return rows.map((item, index) => {
      const document = normalizedDocuments[Number(item?.index)];
      if (!document) throw new Error(`SiliconFlow returned an invalid rerank document index at ${index}`);
      return {
        id: document.id,
        score: normalizeRerankItem(item, index).score,
      };
    });
  }
  return readItems(data).map(normalizeRerankItem);
}
