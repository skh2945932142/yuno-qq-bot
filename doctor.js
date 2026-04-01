import mongoose from 'mongoose';
import axios from 'axios';
import OpenAI from 'openai';
import Redis from 'ioredis';
import { config, validateRuntimeConfig } from './src/config.js';
import { resolveFfmpegPath } from './src/services/audio.js';

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

async function checkRuntimeConfig() {
  validateRuntimeConfig();
  return {
    detail: `model=${config.llmChatModel}, baseUrl=${config.llmBaseUrl}, queue=${config.enableQueue ? 'on' : 'off'}, retrieval=${config.qdrantUrl ? 'on' : 'off'}, voice=${config.enableVoice ? 'on' : 'off'}`,
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

async function checkNapCat() {
  const headers = config.napcatToken
    ? { Authorization: config.napcatToken }
    : {};
  const response = await axios.post(
    `${config.napcatApi}/get_login_info`,
    {},
    {
      headers,
      timeout: config.requestTimeoutMs,
    }
  );

  const body = response.data?.data || response.data || {};
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

async function checkQdrant() {
  if (!config.qdrantUrl || !config.qdrantCollection) {
    return {
      status: 'skip',
      detail: 'retrieval is not configured; set QDRANT_URL and QDRANT_COLLECTION, then run npm run kb:sync',
    };
  }

  const headers = config.qdrantApiKey
    ? { 'api-key': config.qdrantApiKey }
    : {};

  try {
    const response = await axios.get(
      `${config.qdrantUrl}/collections/${config.qdrantCollection}`,
      {
        headers,
        timeout: config.requestTimeoutMs,
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
        ? `collection ${config.qdrantCollection} reachable (vectorSize=${size})`
        : `collection ${config.qdrantCollection} reachable`,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return {
        status: 'warn',
        detail: `Qdrant reachable but collection ${config.qdrantCollection} is missing; run npm run kb:sync`,
      };
    }
    throw error;
  }
}

async function checkVoiceRuntime() {
  if (!config.enableVoice) {
    return {
      status: 'skip',
      detail: 'voice is disabled',
    };
  }

  const ffmpegPath = await resolveFfmpegPath({ skipCache: true });
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
    ['napcat', checkNapCat],
    ['llm', checkLlm],
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
