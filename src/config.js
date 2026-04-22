import dotenv from 'dotenv';

dotenv.config();

function readNumber(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function readJson(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: readNumber('PORT', 3000),
  mongodbUri: process.env.MONGODB_URI || '',
  mongoMaxPoolSize: readNumber('MONGO_MAX_POOL_SIZE', 10),
  llmApiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.SILICONFLOW_API_KEY || '',
  llmBaseUrl: (process.env.LLM_BASE_URL
    || process.env.OPENAI_BASE_URL
    || (process.env.SILICONFLOW_API_KEY ? 'https://api.siliconflow.cn/v1' : 'https://api.openai.com/v1'))
    .replace(/\/+$/, ''),
  llmChatModel: process.env.LLM_CHAT_MODEL || (process.env.SILICONFLOW_API_KEY ? 'Pro/MiniMaxAI/MiniMax-M2.5' : ''),
  embeddingModel: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
  ttsApiKey: process.env.TTS_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.SILICONFLOW_API_KEY || '',
  ttsBaseUrl: (process.env.TTS_BASE_URL || (process.env.SILICONFLOW_API_KEY ? 'https://api.siliconflow.cn/v1/audio/speech' : ''))
    .replace(/\/+$/, ''),
  ttsModel: process.env.TTS_MODEL || 'FunAudioLLM/CosyVoice2-0.5B',
  napcatApi: (process.env.NAPCAT_API || '').replace(/\/+$/, ''),
  napcatToken: process.env.NAPCAT_TOKEN || '',
  targetGroupId: process.env.TARGET_GROUP_ID ? String(process.env.TARGET_GROUP_ID) : '',
  adminQq: process.env.ADMIN_QQ ? String(process.env.ADMIN_QQ) : '',
  // SELF_QQ is the bot's own QQ number. It is used as a fallback when the
  // OneBot adapter omits self_id from the event payload, ensuring that
  // direct-mention detection ([CQ:at,qq=SELF_QQ]) never silently fails.
  selfQq: process.env.SELF_QQ ? String(process.env.SELF_QQ) : '',
  yunoVoiceUri: process.env.YUNO_VOICE_URI || '',
  enableVoice: readBoolean('ENABLE_VOICE', false),
  ffmpegPath: process.env.FFMPEG_PATH || '',
  voiceSampleRate: readNumber('VOICE_SAMPLE_RATE', 24000),
  voiceBitrate: readNumber('VOICE_BITRATE', 24000),
  requestTimeoutMs: readNumber('REQUEST_TIMEOUT_MS', 15000),
  replyTimeBudgetMs: readNumber('REPLY_TIME_BUDGET_MS', 3500),
  modelFallbackChatModel: process.env.MODEL_FALLBACK_CHAT_MODEL || '',
  modelCircuitFailureThreshold: readNumber('MODEL_CIRCUIT_FAILURE_THRESHOLD', 3),
  modelCircuitOpenMs: readNumber('MODEL_CIRCUIT_OPEN_MS', 20000),
  retryAttempts: readNumber('RETRY_ATTEMPTS', 2),
  retryDelayMs: readNumber('RETRY_DELAY_MS', 400),
  groupChatMaxTokens: readNumber('GROUP_CHAT_MAX_TOKENS', 360),
  privateChatMaxTokens: readNumber('PRIVATE_CHAT_MAX_TOKENS', 520),
  knowledgeReplyMaxTokens: readNumber('KNOWLEDGE_REPLY_MAX_TOKENS', 640),
  groupReplyLengthTier: process.env.GROUP_REPLY_LENGTH_TIER || 'balanced',
  privateReplyLengthTier: process.env.PRIVATE_REPLY_LENGTH_TIER || 'expanded',
  chatFollowupRatePrivate: readNumber('CHAT_FOLLOWUP_RATE_PRIVATE', 0.72),
  chatFollowupRateGroup: readNumber('CHAT_FOLLOWUP_RATE_GROUP', 0.24),
  chatStyleRepeatGuard: readBoolean('CHAT_STYLE_REPEAT_GUARD', true),
  chatEllipsisLimit: readNumber('CHAT_ELLIPSIS_LIMIT', 2),
  qdrantUrl: (process.env.QDRANT_URL || '').replace(/\/+$/, ''),
  qdrantApiKey: process.env.QDRANT_API_KEY || '',
  qdrantCollection: process.env.QDRANT_COLLECTION || 'qq_bot_knowledge',
  qdrantTopK: readNumber('QDRANT_TOP_K', 4),
  qdrantMinScore: readNumber('QDRANT_MIN_SCORE', 0.2),
  qdrantCharLimit: readNumber('QDRANT_CHAR_LIMIT', 1200),
  knowledgeQueryCacheTtlMs: readNumber('KNOWLEDGE_QUERY_CACHE_TTL_MS', 30000),
  enableQueue: readBoolean('ENABLE_QUEUE', false),
  redisUrl: process.env.REDIS_URL || '',
  replyQueueName: process.env.REPLY_QUEUE_NAME || 'reply_job',
  persistQueueName: process.env.PERSIST_QUEUE_NAME || 'persist_job',
  queueRetryAttempts: readNumber('QUEUE_RETRY_ATTEMPTS', 3),
  queueBackoffMs: readNumber('QUEUE_BACKOFF_MS', 500),
  queueConcurrency: Object.freeze({
    default: readNumber('QUEUE_CONCURRENCY_DEFAULT', 4),
    reply: readNumber('QUEUE_CONCURRENCY_REPLY', 2),
    persist: readNumber('QUEUE_CONCURRENCY_PERSIST', 4),
  }),
  automationTaskConcurrency: readNumber('AUTOMATION_TASK_CONCURRENCY', 3),
  groupEventRetentionCount: readNumber('GROUP_EVENT_RETENTION_COUNT', 100),
  otlpEndpoint: process.env.OTLP_ENDPOINT || '',
  enableMetrics: readBoolean('ENABLE_METRICS', true),
  metricsPath: process.env.METRICS_PATH || '/metrics',
  logLevel: process.env.LOG_LEVEL || 'info',
  traceSampleRate: readNumber('TRACE_SAMPLE_RATE', 1),
  specialUsers: readJson('SPECIAL_USERS_JSON', []),
  memeEnabled: readBoolean('MEME_ENABLED', true),
  memeAutoCollect: readBoolean('MEME_AUTO_COLLECT', true),
  memeAutoSend: readBoolean('MEME_AUTO_SEND', false),
  memeStorageDir: process.env.MEME_STORAGE_DIR || 'data/memes',
  memeEnabledGroups: readJson('MEME_ENABLED_GROUPS', []),
  memeOptOutUsers: readJson('MEME_OPT_OUT_USERS', []),
  memeRequireAdminForAutoMode: readBoolean('MEME_REQUIRE_ADMIN_FOR_AUTO_MODE', true),
});

export function validateRuntimeConfig() {
  const required = [
    ['MONGODB_URI', config.mongodbUri],
    ['LLM_API_KEY/OPENAI_API_KEY/SILICONFLOW_API_KEY', config.llmApiKey],
    ['LLM_CHAT_MODEL', config.llmChatModel],
    ['NAPCAT_API', config.napcatApi],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function isAdvancedGroup(groupId) {
  return Boolean(config.targetGroupId) && String(groupId) === config.targetGroupId;
}
