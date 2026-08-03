import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';
import { withRetry } from './retry.js';

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveRuntime(options = {}) {
  const runtimeConfig = options.config || config;
  return {
    url: normalizeUrl(options.url ?? runtimeConfig.retrievalGatewayUrl),
    apiKey: String(options.apiKey ?? runtimeConfig.retrievalGatewayApiKey ?? '').trim(),
    embeddingModel: String(options.embeddingModel ?? runtimeConfig.retrievalEmbeddingModel ?? '').trim(),
    rerankModel: String(options.rerankModel ?? runtimeConfig.retrievalRerankModel ?? '').trim(),
    embeddingTimeoutMs: Math.max(200, Number(options.embeddingTimeoutMs ?? runtimeConfig.retrievalGatewayTimeoutMs ?? 1800)),
    rerankTimeoutMs: Math.max(200, Number(options.rerankTimeoutMs ?? runtimeConfig.retrievalRerankTimeoutMs ?? 1800)),
    httpClient: options.httpClient || axios,
  };
}

export function isRetrievalGatewayConfigured(options = {}) {
  const runtime = resolveRuntime(options);
  return Boolean(runtime.url && runtime.embeddingModel && runtime.rerankModel);
}

function buildHeaders(runtime) {
  return runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {};
}

async function requestGateway(path, payload, timeoutMs, operation, options = {}) {
  const runtime = resolveRuntime(options);
  if (!runtime.url) throw new Error('Retrieval Gateway is not configured');

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
    });
    recordWorkflowMetric('yuno_retrieval_gateway_duration_ms', Date.now() - startedAt, {
      operation,
      result: 'success',
    }, 'histogram');
    return response.data;
  } catch (error) {
    recordWorkflowMetric('yuno_retrieval_gateway_requests_total', 1, {
      operation,
      result: 'error',
    });
    recordWorkflowMetric('yuno_retrieval_gateway_duration_ms', Date.now() - startedAt, {
      operation,
      result: 'error',
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

function normalizeEmbeddingItem(item, index) {
  const dense = normalizeDense(item?.dense || item?.embedding || item?.vector);
  const sparse = normalizeSparse(item?.sparse || item?.lexical);
  if (!dense || !sparse) {
    throw new Error(`Retrieval Gateway returned invalid hybrid embedding at index ${index}`);
  }
  return {
    id: String(item?.id ?? index),
    dense,
    sparse,
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
  const data = await requestGateway('/v1/embed', {
    model: runtime.embeddingModel,
    task: options.task || 'query',
    inputs: normalizedTexts.map((text, index) => ({ id: String(index), text })),
  }, runtime.embeddingTimeoutMs, 'embed', options);
  const items = readItems(data).map(normalizeEmbeddingItem);
  if (items.length !== normalizedTexts.length) {
    throw new Error(`Retrieval Gateway returned ${items.length} embeddings for ${normalizedTexts.length} inputs`);
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
  const data = await requestGateway('/v1/rerank', {
    model: runtime.rerankModel,
    query: normalizedQuery,
    documents: normalizedDocuments,
    topN: Math.min(normalizedDocuments.length, Math.max(1, Number(options.topN || normalizedDocuments.length))),
  }, runtime.rerankTimeoutMs, 'rerank', options);
  return readItems(data).map(normalizeRerankItem);
}
