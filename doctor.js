import mongoose from 'mongoose';
import axios from 'axios';
import OpenAI from 'openai';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';
import { config, describeHttpBaseUrlProblem, validateRuntimeConfig } from './src/config.js';
import { resolveFfmpegPath } from './src/services/audio.js';
import { createEmbeddings } from './src/minimax.js';
import { embedHybridTexts, getRetrievalProviderStatus, rerankHybridCandidates } from './src/retrieval-gateway.js';

function truncateValue(value, limit = 120) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1))}...`;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) {
    return '0ms';
  }

  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }

  return `${(value / 1000).toFixed(2)}s`;
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function printCheckLine(result) {
  const label = String(result.status || '').trim().toUpperCase().padEnd(10, ' ');
  const parts = [`[${label}]`, result.name];

  if (result.elapsedMs !== undefined) {
    parts.push(`(${formatDuration(result.elapsedMs)})`);
  }

  if (result.detail) {
    parts.push(`- ${result.detail}`);
  }

  console.log(parts.join(' '));
}

function summarizeResults(results) {
  const summary = {
    pass: 0,
    fail: 0,
    warn: 0,
    skip: 0,
  };

  for (const result of results) {
    if (summary[result.status] === undefined) {
      continue;
    }
    summary[result.status] += 1;
  }

  return summary;
}

function hasFailures(results) {
  return results.some((result) => result.status === 'fail');
}

function extractMongoHost(uri) {
  const normalized = String(uri || '').trim();
  if (!normalized) {
    return '';
  }

  const withoutScheme = normalized.replace(/^mongodb(\+srv)?:\/\//i, '');
  const authority = withoutScheme.split('/')[0] || '';
  const afterAuth = authority.includes('@') ? authority.split('@').pop() : authority;
  const firstHost = String(afterAuth || '').split(',')[0] || '';
  return String(firstHost).split(':')[0] || '';
}

function looksLikeDockerOnlyHost(host) {
  if (!host) {
    return false;
  }

  if (host === 'localhost' || host === '127.0.0.1') {
    return false;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return false;
  }

  return !host.includes('.');
}

function buildResult(name, status, detail, elapsedMs) {
  return {
    name,
    status,
    detail,
    elapsedMs,
  };
}

async function runCheck(name, executor) {
  const startedAt = Date.now();

  try {
    const outcome = await executor();
    if (outcome?.status) {
      return buildResult(name, outcome.status, outcome.detail, Date.now() - startedAt);
    }

    return buildResult(name, 'pass', outcome?.detail || 'ok', Date.now() - startedAt);
  } catch (error) {
    return buildResult(name, 'fail', truncateValue(error.message || String(error), 200), Date.now() - startedAt);
  }
}

async function checkRuntimeConfig(options = {}) {
  const runtimeConfig = options.config || config;
  validateRuntimeConfig();
  return {
    detail: `model=${runtimeConfig.llmChatModel}, baseUrl=${runtimeConfig.llmBaseUrl}, queue=${runtimeConfig.enableQueue ? 'on' : 'off'}, retrieval=${runtimeConfig.qdrantUrl ? 'on' : 'off'}, voice=${runtimeConfig.enableVoice ? 'on' : 'off'}`,
  };
}

async function checkMongo() {
  const host = extractMongoHost(config.mongodbUri);
  const connection = mongoose.createConnection(config.mongodbUri, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: Math.min(config.requestTimeoutMs, 8000),
  });

  try {
    await connection.asPromise();
    return {
      detail: `connected to ${connection.name || 'mongodb'} (${connection.host || 'unknown-host'})`,
    };
  } catch (error) {
    const message = String(error?.message || '');
    if ((error.code === 'ENOTFOUND' || /ENOTFOUND/i.test(message)) && looksLikeDockerOnlyHost(host)) {
      throw new Error(
        `Mongo host "${host}" looks like a Docker/internal service name. If Node runs on the host, replace MONGODB_URI with a host-reachable address like 127.0.0.1 or your server IP.`
      );
    }

    throw error;
  } finally {
    await connection.close().catch(() => {});
  }
}

async function callOneBotWebSocketAction(endpoint, token, timeoutMs, options = {}) {
  const WebSocketImpl = options.WebSocket || WebSocket;
  const echo = 'yuno-doctor:get-login-info';

  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(endpoint, token ? {
      headers: { Authorization: `Bearer ${token}` },
    } : undefined);
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING) {
        socket.close();
      }
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error('OneBot WebSocket request timed out'));
    }, Math.max(1000, Number(timeoutMs || 8000)));

    socket.once('open', () => {
      socket.send(JSON.stringify({
        action: 'get_login_info',
        params: {},
        echo,
      }));
    });
    socket.on('message', (payload) => {
      let body;
      try {
        body = JSON.parse(String(payload));
      } catch {
        return;
      }
      if (body?.echo !== echo) return;
      if (body.status === 'failed' || Number(body.retcode || 0) !== 0) {
        finish(new Error(`OneBot action failed with retcode ${body.retcode ?? 'unknown'}`));
        return;
      }
      finish(null, body.data || body);
    });
    socket.once('error', (error) => finish(error));
    socket.once('close', (code) => {
      if (!settled) finish(new Error(`OneBot WebSocket closed before response (${code})`));
    });
  });
}

async function checkOneBot(options = {}) {
  const runtimeConfig = options.config || config;
  if (!runtimeConfig.onebotEndpoint) {
    throw new Error('ONEBOT_ENDPOINT is not configured');
  }

  const endpoint = new URL(runtimeConfig.onebotEndpoint);
  let body;
  if (endpoint.protocol === 'ws:' || endpoint.protocol === 'wss:') {
    const callWebSocketAction = options.callWebSocketAction || callOneBotWebSocketAction;
    body = await callWebSocketAction(
      runtimeConfig.onebotEndpoint,
      runtimeConfig.onebotToken,
      runtimeConfig.requestTimeoutMs
    );
  } else {
    const httpPost = options.httpPost || axios.post;
    const headers = runtimeConfig.onebotToken
      ? { Authorization: `Token ${runtimeConfig.onebotToken}` }
      : {};
    const response = await httpPost(
      `${runtimeConfig.onebotEndpoint}/get_login_info`,
      {},
      {
        headers,
        maxRedirects: 0,
        timeout: runtimeConfig.requestTimeoutMs,
      }
    );
    body = response.data?.data || response.data || {};
  }

  const nickname = body.nickname || body.nick_name || '';
  const userId = body.user_id || body.userId || '';
  return {
    detail: `reachable as ${nickname || userId || 'unknown-bot'}`,
  };
}

async function checkLlm() {
  const client = new OpenAI({
    apiKey: config.llmApiKey,
    baseURL: config.llmBaseUrl,
    timeout: config.requestTimeoutMs,
  });

  const response = await client.chat.completions.create({
    model: config.llmChatModel,
    temperature: 0,
    max_tokens: 12,
    messages: [
      {
        role: 'system',
        content: 'Reply with exactly OK.',
      },
      {
        role: 'user',
        content: 'health check',
      },
    ],
  });

  const text = response.choices?.[0]?.message?.content?.trim() || '';
  const containsHiddenReasoning = /<(think|thinking)\b/i.test(text);
  if (containsHiddenReasoning) {
    return {
      status: 'warn',
      detail: `model responded with hidden reasoning markers: "${truncateValue(text || '(empty)', 80)}"`,
    };
  }

  return {
    detail: `model responded with "${truncateValue(text || '(empty)', 40)}"`,
  };
}

async function checkEmbedding(options = {}) {
  const runtimeConfig = options.config || config;
  const createEmbeddingRows = options.createEmbeddings || createEmbeddings;
  if (!runtimeConfig.qdrantUrl || !runtimeConfig.qdrantCollection) {
    return {
      status: 'skip',
      detail: 'retrieval is not configured, so embedding health is not required.',
    };
  }

  const rows = await createEmbeddingRows(['embedding health check'], {
    model: runtimeConfig.embeddingModel,
    operation: 'embedding-health-check',
    timeoutMs: Math.min(runtimeConfig.requestTimeoutMs, 15000),
  });
  const vector = rows?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0 || !vector.every((item) => Number.isFinite(item))) {
    throw new Error(`Embedding provider returned an invalid vector for ${runtimeConfig.embeddingModel || '(unset)'}`);
  }

  return {
    detail: `model=${runtimeConfig.embeddingModel}, baseUrl=${runtimeConfig.embeddingBaseUrl || '(unset)'}, vectorSize=${vector.length}`,
  };
}

async function checkRetrievalProvider(options = {}) {
  const runtimeConfig = options.config || config;
  if (!runtimeConfig.retrievalHybridEnabled) {
    return {
      status: 'skip',
      detail: 'retrieval v2 is disabled',
    };
  }

  const providerStatus = getRetrievalProviderStatus({ config: runtimeConfig });
  if (!providerStatus.configured) {
    throw new Error(`retrieval provider ${providerStatus.provider} is missing ${providerStatus.missing.join(', ')}`);
  }

  const embed = options.embedHybridTexts || embedHybridTexts;
  const rerank = options.rerankHybridCandidates || rerankHybridCandidates;
  const [embedding] = await embed(['retrieval health check'], {
    task: 'query',
    config: runtimeConfig,
  });
  if (!Array.isArray(embedding?.dense) || embedding.dense.length === 0) {
    throw new Error('retrieval provider returned an invalid dense vector');
  }
  if (providerStatus.supportsSparse && !embedding?.sparse) {
    throw new Error('retrieval gateway returned no sparse vector');
  }

  const reranked = await rerank('retrieval health check', [{ id: 'probe', text: 'retrieval health check' }], {
    topN: 1,
    config: runtimeConfig,
  });
  if (!Number.isFinite(Number(reranked?.[0]?.score)) || String(reranked?.[0]?.id) !== 'probe') {
    throw new Error('retrieval provider returned an invalid rerank result');
  }

  return {
    detail: `provider=${providerStatus.provider}, mode=${providerStatus.supportsSparse ? 'hybrid' : 'dense-rerank'}, vectorSize=${embedding.dense.length}, rerank=ok`,
  };
}

async function checkQdrant(options = {}) {
  const runtimeConfig = options.config || config;
  const httpGet = options.httpGet || axios.get;
  const collection = runtimeConfig.retrievalHybridEnabled
    ? String(runtimeConfig.qdrantHybridCollection || '').trim()
    : runtimeConfig.qdrantCollection;
  if (!runtimeConfig.qdrantUrl || !collection) {
    if (runtimeConfig.retrievalHybridEnabled) {
      throw new Error('retrieval v2 is enabled but QDRANT_URL or QDRANT_HYBRID_COLLECTION is missing');
    }
    return {
      status: 'skip',
      detail: 'retrieval is not configured. This is fine for text-only mode; set QDRANT_URL and QDRANT_COLLECTION, then run npm run kb:sync when you want RAG.',
    };
  }

  const urlProblem = describeHttpBaseUrlProblem(runtimeConfig.qdrantUrl);
  if (urlProblem) {
    return {
      status: 'fail',
      detail: `QDRANT_URL is invalid (${urlProblem}). Use a full URL such as http://qdrant:6333 or https://your-qdrant-endpoint.`,
    };
  }

  const headers = runtimeConfig.qdrantApiKey
    ? { 'api-key': runtimeConfig.qdrantApiKey }
    : {};

  try {
    const response = await httpGet(
      `${runtimeConfig.qdrantUrl}/collections/${collection}`,
      {
        headers,
        maxRedirects: 0,
        timeout: runtimeConfig.requestTimeoutMs,
      }
    );
    const vectorConfig = response.data?.result?.config?.params?.vectors;
    const size = typeof vectorConfig?.size === 'number'
      ? vectorConfig.size
      : typeof vectorConfig === 'object'
        ? Object.values(vectorConfig)[0]?.size
        : null;

    return {
      detail: size
        ? `collection ${collection} reachable (vectorSize=${size})`
        : `collection ${collection} reachable`,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return {
        status: 'warn',
        detail: `Qdrant reachable but collection ${collection} is missing; run ${runtimeConfig.retrievalHybridEnabled ? 'npm run retrieval:backfill' : 'npm run kb:sync'}`,
      };
    }
    throw error;
  }
}

async function checkVoiceRuntime(options = {}) {
  const runtimeConfig = options.config || config;
  const resolveFfmpegPathFn = options.resolveFfmpegPathFn || resolveFfmpegPath;
  if (!runtimeConfig.enableVoice) {
    return {
      status: 'skip',
      detail: 'voice is disabled. This is fine for text-only mode; enable it only after ffmpeg and TTS are configured.',
    };
  }

  const ffmpegPath = await resolveFfmpegPathFn({ skipCache: true });
  if (!ffmpegPath) {
    throw new Error(
      'voice is enabled but ffmpeg could not be resolved. Install ffmpeg and set FFMPEG_PATH (Linux usually /usr/bin/ffmpeg, Windows usually C:\\ffmpeg\\bin\\ffmpeg.exe).'
    );
  }

  return {
    detail: `ffmpeg=${ffmpegPath}`,
  };
}

async function checkQueueRuntime() {
  if (!config.enableQueue) {
    return {
      status: 'skip',
      detail: 'queue is disabled',
    };
  }

  if (!config.redisUrl) {
    throw new Error('queue is enabled but REDIS_URL is missing');
  }

  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    return {
      detail: `redis ping=${pong}`,
    };
  } finally {
    await redis.quit().catch(() => redis.disconnect());
  }
}

async function main() {
  printHeader('Yuno Runtime Doctor');
  console.log(`nodeEnv=${config.nodeEnv}`);
  console.log(`platform=${process.platform}`);
  console.log(`llmBaseUrl=${config.llmBaseUrl || '(unset)'}`);
  console.log(`llmModel=${config.llmChatModel || '(unset)'}`);

  const checks = [
    ['env', checkRuntimeConfig],
    ['mongo', checkMongo],
    ['onebot', checkOneBot],
    ['llm', checkLlm],
    ['embedding', checkEmbedding],
    ['retrieval-provider', checkRetrievalProvider],
    ['qdrant', checkQdrant],
    ['voice', checkVoiceRuntime],
    ['queue', checkQueueRuntime],
  ];

  const results = [];
  for (const [name, executor] of checks) {
    const result = await runCheck(name, executor);
    results.push(result);
    printCheckLine(result);
  }

  const summary = summarizeResults(results);
  printHeader('Summary');
  console.log(`pass=${summary.pass} warn=${summary.warn} skip=${summary.skip} fail=${summary.fail}`);

  process.exitCode = hasFailures(results) ? 1 : 0;
}

export {
  checkRuntimeConfig,
  checkMongo,
  checkOneBot,
  callOneBotWebSocketAction,
  checkLlm,
  checkEmbedding,
  checkRetrievalProvider,
  checkQdrant,
  checkVoiceRuntime,
  checkQueueRuntime,
  runCheck,
  summarizeResults,
  hasFailures,
  main as runDoctor,
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
