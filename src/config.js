import dotenv from 'dotenv';

dotenv.config();

const resolvedTtsProvider = (process.env.TTS_PROVIDER || 'openai_compatible').trim().toLowerCase() || 'openai_compatible';
const resolvedLlmApiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.SILICONFLOW_API_KEY || process.env.GEMINI_API_KEY || '';
const resolvedLlmBaseUrl = normalizeBaseUrl(process.env.LLM_BASE_URL
  || process.env.OPENAI_BASE_URL
  || (process.env.GEMINI_API_KEY
    ? 'https://generativelanguage.googleapis.com/v1beta/openai'
    : (process.env.SILICONFLOW_API_KEY ? 'https://api.siliconflow.cn/v1' : 'https://api.openai.com/v1')));
const resolvedLlmChatModel = process.env.LLM_CHAT_MODEL
  || (process.env.GEMINI_API_KEY
    ? 'gemini-3.5-flash'
    : (process.env.SILICONFLOW_API_KEY ? 'Pro/MiniMaxAI/MiniMax-M2.5' : ''));
const configuredReplyLlmChatModel = process.env.REPLY_LLM_CHAT_MODEL || resolvedLlmChatModel;
const hasDedicatedReplyLlm = Boolean(process.env.REPLY_LLM_API_KEY
  || process.env.REPLY_LLM_BASE_URL
  || process.env.REPLY_LLM_CHAT_MODEL
  || process.env.GEMINI_API_KEY);
const shouldUseGeminiReplyDefaults = Boolean(process.env.GEMINI_API_KEY)
  || /gemini/i.test(configuredReplyLlmChatModel)
  || /generativelanguage\.googleapis\.com/i.test(process.env.LLM_BASE_URL || '');
const resolvedReplyLlmApiKey = process.env.REPLY_LLM_API_KEY
  || process.env.GEMINI_API_KEY
  || resolvedLlmApiKey;
const resolvedReplyLlmBaseUrl = normalizeBaseUrl(process.env.REPLY_LLM_BASE_URL
  || (shouldUseGeminiReplyDefaults
    ? 'https://generativelanguage.googleapis.com/v1beta/openai'
    : resolvedLlmBaseUrl));
const resolvedReplyLlmChatModel = process.env.REPLY_LLM_CHAT_MODEL
  || (process.env.GEMINI_API_KEY ? 'gemini-3.5-flash' : configuredReplyLlmChatModel);
const resolvedReplyLlmFallbackApiKey = process.env.REPLY_LLM_FALLBACK_API_KEY
  || process.env.EMBEDDING_API_KEY
  || resolvedReplyLlmApiKey;
const resolvedReplyLlmFallbackBaseUrl = normalizeBaseUrl(process.env.REPLY_LLM_FALLBACK_BASE_URL
  || process.env.EMBEDDING_BASE_URL
  || resolvedReplyLlmBaseUrl);
const defaultTtsBaseUrl = resolvedTtsProvider === 'mimo'
  ? 'https://api.xiaomimimo.com/v1/chat/completions'
  : (process.env.SILICONFLOW_API_KEY ? 'https://api.siliconflow.cn/v1/audio/speech' : '');
const defaultTtsModel = resolvedTtsProvider === 'mimo'
  ? 'mimo-v2.5-tts'
  : 'FunAudioLLM/CosyVoice2-0.5B';
const defaultTtsVoiceDesign = '十八岁左右的年轻女性声线，清亮、干净、略偏高但不尖，带一点紧张感与敏锐感；咬字清晰、气息稳定，避免气声、耳语、沙哑和明显呼吸噪声。语速自然，节奏利落，短句停顿干净；语气专注、果断，偶尔带一点轻微占有欲和俏皮，但不慵懒、不甜腻、不夹、不夸张动漫腔。面对在意的人时稍微柔和，但保持清醒和利落。';

function readNumber(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readProbability(name, fallback) {
  const parsed = readNumber(name, fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
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

function readTrimmed(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function readEnum(name, allowed, fallback) {
  const value = readTrimmed(name, fallback).toLowerCase();
  return allowed.includes(value) ? value : fallback;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeMetricsPath(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '/metrics';
  if (!/^\/[A-Za-z0-9/_-]+$/.test(normalized)) return '/metrics';
  return normalized;
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: readNumber('KOISHI_PORT', readNumber('PORT', 5140)),
  koishiPort: readNumber('KOISHI_PORT', readNumber('PORT', 5140)),
  yunoPluginMode: readEnum('YUNO_PLUGIN_MODE', ['active', 'shadow'], 'active'),
  onebotTransport: readEnum('ONEBOT_TRANSPORT', ['ws'], 'ws'),
  onebotEndpoint: normalizeBaseUrl(process.env.ONEBOT_ENDPOINT || ''),
  onebotToken: readTrimmed('ONEBOT_TOKEN'),
  koishiMongoUri: process.env.KOISHI_MONGODB_URI || '',
  koishiConsoleEnabled: readBoolean('KOISHI_CONSOLE_ENABLED', true),
  koishiConsoleAdmin: readTrimmed('KOISHI_CONSOLE_ADMIN'),
  koishiConsolePassword: readTrimmed('KOISHI_CONSOLE_PASSWORD'),
  botExperienceMode: readTrimmed('BOT_EXPERIENCE_MODE', 'companion'),
  dailyMoodEnabled: readBoolean('BOT_DAILY_MOOD_ENABLED', true),
  dailyMoodSeed: readTrimmed('BOT_DAILY_MOOD_SEED', 'yuno-daily-mood-v1'),
  dailyMoodTimezone: readTrimmed('BOT_DAILY_MOOD_TIMEZONE', 'Asia/Shanghai'),
  dailyMoodOverride: readTrimmed('BOT_DAILY_MOOD_OVERRIDE').toUpperCase(),
  mongodbUri: process.env.MONGODB_URI || '',
  mongoMaxPoolSize: readNumber('MONGO_MAX_POOL_SIZE', 10),
  llmApiKey: resolvedLlmApiKey,
  llmBaseUrl: resolvedLlmBaseUrl,
  llmChatModel: resolvedLlmChatModel,
  replyLlmApiKey: resolvedReplyLlmApiKey,
  replyLlmBaseUrl: resolvedReplyLlmBaseUrl,
  replyLlmChatModel: resolvedReplyLlmChatModel,
  replyLlmFallbackApiKey: resolvedReplyLlmFallbackApiKey,
  replyLlmFallbackBaseUrl: resolvedReplyLlmFallbackBaseUrl,
  replyLlmFallbackChatModel: process.env.REPLY_LLM_FALLBACK_CHAT_MODEL
    || (hasDedicatedReplyLlm ? '' : (process.env.MODEL_FALLBACK_CHAT_MODEL || '')),
  replyLlmReasoningEffort: readEnum('REPLY_LLM_REASONING_EFFORT', ['minimal', 'low', 'medium', 'high'], 'low'),
  replyLlmKnowledgeReasoningEffort: readEnum('REPLY_LLM_KNOWLEDGE_REASONING_EFFORT', ['minimal', 'low', 'medium', 'high'], 'low'),
  replyLlmStructuredOutput: readBoolean('REPLY_LLM_STRUCTURED_OUTPUT', true),
  embeddingApiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || resolvedLlmApiKey,
  embeddingBaseUrl: normalizeBaseUrl(process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || resolvedLlmBaseUrl),
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  ttsProvider: resolvedTtsProvider,
  ttsApiKey: process.env.TTS_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.SILICONFLOW_API_KEY || '',
  ttsBaseUrl: normalizeBaseUrl(process.env.TTS_BASE_URL || defaultTtsBaseUrl),
  ttsModel: process.env.TTS_MODEL || defaultTtsModel,
  targetGroupId: process.env.TARGET_GROUP_ID ? String(process.env.TARGET_GROUP_ID) : '',
  adminQq: process.env.ADMIN_QQ ? String(process.env.ADMIN_QQ) : '',
  // SELF_QQ is the bot's own QQ number. It is used as a fallback when the
  // OneBot adapter omits self_id from the event payload, ensuring that
  // direct-mention detection ([CQ:at,qq=SELF_QQ]) never silently fails.
  selfQq: process.env.SELF_QQ ? String(process.env.SELF_QQ) : '',
  yunoVoiceUri: process.env.YUNO_VOICE_URI || '',
  ttsVoice: process.env.TTS_VOICE || process.env.YUNO_VOICE_URI || '',
  ttsVoiceDesign: process.env.TTS_VOICE_DESIGN || defaultTtsVoiceDesign,
  enableVoice: readBoolean('ENABLE_VOICE', false),
  voiceReplyMode: readTrimmed('VOICE_REPLY_MODE', 'auto').toLowerCase(),
  voiceReplyCooldownMs: readNumber('VOICE_REPLY_COOLDOWN_MS', 90000),
  voiceReplyMaxChars: readNumber('VOICE_REPLY_MAX_CHARS', 90),
  voiceReplyOnUserRecord: readBoolean('VOICE_REPLY_ON_USER_RECORD', true),
  ffmpegPath: process.env.FFMPEG_PATH || '',
  ttsSpeed: Math.min(2, Math.max(0.5, readNumber('TTS_SPEED', 1.15))),
  voiceSampleRate: readNumber('VOICE_SAMPLE_RATE', 24000),
  voiceBitrate: readNumber('VOICE_BITRATE', 24000),
  requestTimeoutMs: readNumber('REQUEST_TIMEOUT_MS', 60000),
  replyTimeBudgetMs: readNumber('REPLY_TIME_BUDGET_MS', 0),
  replyPrimaryTimeoutMs: readNumber('REPLY_PRIMARY_TIMEOUT_MS', 14000),
  replyHardTimeoutMs: readNumber('REPLY_HARD_TIMEOUT_MS', 22000),
  externalToolTimeoutMs: readNumber('EXTERNAL_TOOL_TIMEOUT_MS', 4000),
  modelFallbackChatModel: process.env.MODEL_FALLBACK_CHAT_MODEL || '',
  modelCircuitFailureThreshold: readNumber('MODEL_CIRCUIT_FAILURE_THRESHOLD', 3),
  modelCircuitOpenMs: readNumber('MODEL_CIRCUIT_OPEN_MS', 20000),
  retryAttempts: readNumber('RETRY_ATTEMPTS', 2),
  retryDelayMs: readNumber('RETRY_DELAY_MS', 400),
  groupChatMaxTokens: readNumber('GROUP_CHAT_MAX_TOKENS', 180),
  privateChatMaxTokens: readNumber('PRIVATE_CHAT_MAX_TOKENS', 240),
  knowledgeReplyMaxTokens: readNumber('KNOWLEDGE_REPLY_MAX_TOKENS', 640),
  groupReplyLengthTier: process.env.GROUP_REPLY_LENGTH_TIER || 'balanced',
  privateReplyLengthTier: process.env.PRIVATE_REPLY_LENGTH_TIER || 'expanded',
  chatFollowupRatePrivate: readNumber('CHAT_FOLLOWUP_RATE_PRIVATE', 0.72),
  chatFollowupRateGroup: readNumber('CHAT_FOLLOWUP_RATE_GROUP', 0.24),
  chatStyleRepeatGuard: readBoolean('CHAT_STYLE_REPEAT_GUARD', true),
  chatEllipsisLimit: readNumber('CHAT_ELLIPSIS_LIMIT', 2),
  replySegmentationEnabled: readBoolean('REPLY_SEGMENTATION_ENABLED', true),
  replySegmentMaxCount: readNumber('REPLY_SEGMENT_MAX_COUNT', 3),
  replySegmentMinDelayMs: readNumber('REPLY_SEGMENT_MIN_DELAY_MS', 600),
  replySegmentMaxDelayMs: readNumber('REPLY_SEGMENT_MAX_DELAY_MS', 1400),
  groupReplyQuoteEnabled: readBoolean('GROUP_REPLY_QUOTE_ENABLED', true),
  privateMessageAggregationEnabled: readBoolean('PRIVATE_MESSAGE_AGGREGATION_ENABLED', true),
  privateMessageAggregationWindowMs: readNumber('PRIVATE_MESSAGE_AGGREGATION_WINDOW_MS', 1200),
  privateMessageAggregationMaxWindowMs: readNumber('PRIVATE_MESSAGE_AGGREGATION_MAX_WINDOW_MS', 5000),
  groupReplyQuoteMode: readEnum('GROUP_REPLY_QUOTE_MODE', ['auto', 'always', 'never'], 'auto'),
  replySegmentTrimTrailingPeriod: readBoolean('REPLY_SEGMENT_TRIM_TRAILING_PERIOD', true),
  replyCadenceEnabled: readBoolean('REPLY_CADENCE_ENABLED', true),
  replyCadenceReadMsPerChar: readNumber('REPLY_CADENCE_READ_MS_PER_CHAR', 12),
  replyCadenceReadMaxMs: readNumber('REPLY_CADENCE_READ_MAX_MS', 1200),
  replyCadenceMinPreDelayMs: readNumber('REPLY_CADENCE_MIN_PRE_DELAY_MS', 350),
  replyCadenceMaxPreDelayMs: readNumber('REPLY_CADENCE_MAX_PRE_DELAY_MS', 1800),
  replyCadenceTypingMsPerChar: readNumber('REPLY_CADENCE_TYPING_MS_PER_CHAR', 70),
  replyCadenceTypingMaxMs: readNumber('REPLY_CADENCE_TYPING_MAX_MS', 2600),
  replyCadenceJitterRatio: readProbability('REPLY_CADENCE_JITTER_RATIO', 0.25),
  typingIndicatorEnabled: readBoolean('TYPING_INDICATOR_ENABLED', true),
  groupMessageAggregationEnabled: readBoolean('GROUP_MESSAGE_AGGREGATION_ENABLED', true),
  groupMessageAggregationWindowMs: readNumber('GROUP_MESSAGE_AGGREGATION_WINDOW_MS', 900),
  groupMessageAggregationMaxWindowMs: readNumber('GROUP_MESSAGE_AGGREGATION_MAX_WINDOW_MS', 3000),
  participationSkipProbability: readProbability('PARTICIPATION_SKIP_PROBABILITY', 0.12),
  participationReactionProbability: readProbability('PARTICIPATION_REACTION_PROBABILITY', 0.18),
  participationMaxConsecutiveReplies: readNumber('PARTICIPATION_MAX_CONSECUTIVE_REPLIES', 2),
  ambientJoinEnabled: readBoolean('AMBIENT_JOIN_ENABLED', false),
  ambientJoinProbability: readProbability('AMBIENT_JOIN_PROBABILITY', 0.005),
  ambientJoinCooldownMs: readNumber('AMBIENT_JOIN_COOLDOWN_MS', 600000),
  ambientJoinMaxPerDay: readNumber('AMBIENT_JOIN_MAX_PER_DAY', 6),
  proactiveMessagesEnabled: readBoolean('PROACTIVE_MESSAGES_ENABLED', false),
  qdrantUrl: normalizeBaseUrl(process.env.QDRANT_URL || ''),
  qdrantApiKey: process.env.QDRANT_API_KEY || '',
  qdrantCollection: process.env.QDRANT_COLLECTION || 'qq_bot_knowledge',
  // Retrieval v2 is opt-in while the old Dense collection remains available
  // for rollback. The gateway supports full hybrid; SiliconFlow uses Dense +
  // Rerank against the same v2 collection until a sparse provider is added.
  qdrantHybridCollection: process.env.QDRANT_HYBRID_COLLECTION || '',
  retrievalProvider: readEnum('RETRIEVAL_PROVIDER', ['gateway', 'siliconflow'], 'gateway'),
  retrievalGatewayUrl: normalizeBaseUrl(process.env.RETRIEVAL_GATEWAY_URL || ''),
  retrievalGatewayApiKey: readTrimmed('RETRIEVAL_GATEWAY_API_KEY'),
  retrievalEmbeddingModel: readTrimmed('RETRIEVAL_GATEWAY_EMBED_MODEL', 'BAAI/bge-m3'),
  retrievalRerankModel: readTrimmed('RETRIEVAL_RERANK_MODEL', 'BAAI/bge-reranker-v2-m3'),
  retrievalGatewayTimeoutMs: readNumber('RETRIEVAL_GATEWAY_TIMEOUT_MS', 1800),
  retrievalRerankTimeoutMs: readNumber('RETRIEVAL_RERANK_TIMEOUT_MS', 1800),
  retrievalHybridEnabled: readBoolean('RETRIEVAL_HYBRID_ENABLED', false),
  retrievalCandidateLimit: readNumber('RETRIEVAL_CANDIDATE_LIMIT', 20),
  retrievalRerankLimit: readNumber('RETRIEVAL_RERANK_LIMIT', 12),
  retrievalQueryRewriteEnabled: readBoolean('RETRIEVAL_QUERY_REWRITE_ENABLED', true),
  retrievalQueryRewriteTimeoutMs: readNumber('RETRIEVAL_QUERY_REWRITE_TIMEOUT_MS', 900),
  retrievalQueryRewriteCacheTtlMs: readNumber('RETRIEVAL_QUERY_REWRITE_CACHE_TTL_MS', 300000),
  retrievalVectorCacheTtlMs: readNumber('RETRIEVAL_VECTOR_CACHE_TTL_MS', 600000),
  retrievalKnowledgeCacheTtlMs: readNumber('RETRIEVAL_KNOWLEDGE_CACHE_TTL_MS', 60000),
  qdrantTopK: readNumber('QDRANT_TOP_K', 4),
  qdrantMinScore: readNumber('QDRANT_MIN_SCORE', 0.25),
  qdrantCharLimit: readNumber('QDRANT_CHAR_LIMIT', 1200),
  knowledgeQueryCacheTtlMs: readNumber('KNOWLEDGE_QUERY_CACHE_TTL_MS', 30000),
  enableQueue: readBoolean('ENABLE_QUEUE', false),
  redisUrl: process.env.REDIS_URL || '',
  replyQueueName: process.env.REPLY_QUEUE_NAME || 'reply_job',
  persistQueueName: process.env.PERSIST_QUEUE_NAME || 'persist_job',
  queueRetryAttempts: readNumber('QUEUE_RETRY_ATTEMPTS', 3),
  queueBackoffMs: readNumber('QUEUE_BACKOFF_MS', 500),
  queueConnectTimeoutMs: readNumber('QUEUE_CONNECT_TIMEOUT_MS', 3000),
  queueConcurrency: Object.freeze({
    default: readNumber('QUEUE_CONCURRENCY_DEFAULT', 4),
    reply: readNumber('QUEUE_CONCURRENCY_REPLY', 2),
    persist: readNumber('QUEUE_CONCURRENCY_PERSIST', 4),
  }),
  automationTaskConcurrency: readNumber('AUTOMATION_TASK_CONCURRENCY', 3),
  schedulerTaskLockMs: readNumber('SCHEDULER_TASK_LOCK_MS', 120000),
  maxActiveRemindersPerUser: readNumber('MAX_ACTIVE_REMINDERS_PER_USER', 20),
  maxActiveSubscriptionsPerUser: readNumber('MAX_ACTIVE_SUBSCRIPTIONS_PER_USER', 10),
  groupEventRetentionCount: readNumber('GROUP_EVENT_RETENTION_COUNT', 100),
  otlpEndpoint: process.env.OTLP_ENDPOINT || '',
  enableMetrics: readBoolean('ENABLE_METRICS', true),
  metricsPath: normalizeMetricsPath(process.env.METRICS_PATH || '/metrics'),
  metricsAuthToken: readTrimmed('METRICS_AUTH_TOKEN'),
  logLevel: process.env.LOG_LEVEL || 'info',
  traceSampleRate: readNumber('TRACE_SAMPLE_RATE', 1),
  visionApiKey: readTrimmed('VISION_API_KEY'),
  visionBaseUrl: normalizeBaseUrl(process.env.VISION_BASE_URL || ''),
  visionModel: readTrimmed('VISION_MODEL'),
  ocrApiKey: readTrimmed('OCR_API_KEY'),
  ocrBaseUrl: normalizeBaseUrl(process.env.OCR_BASE_URL || ''),
  searchApiKey: readTrimmed('SEARCH_API_KEY'),
  searchBaseUrl: normalizeBaseUrl(process.env.SEARCH_BASE_URL || ''),
  memorySummaryModel: readTrimmed('MEMORY_SUMMARY_MODEL'),
  memoryExtractionEnabled: readBoolean('MEMORY_EXTRACTION_ENABLED', true),
  memoryFactExtractionEnabled: readBoolean('MEMORY_FACT_EXTRACTION_ENABLED', false),
  memoryFactConfidenceThreshold: readNumber('MEMORY_FACT_CONFIDENCE_THRESHOLD', 0.75),
  messageLogRetentionDays: readNumber('MESSAGE_LOG_RETENTION_DAYS', 30),
  groupDialogueWindowMs: readNumber('GROUP_DIALOGUE_WINDOW_MS', 3 * 60 * 1000),
  // Private chat always answers, so it used to skip the classifier entirely and
  // take sentiment/intent from regex rules. This runs a semantic pass in parallel
  // with context loading so the persona layer gets accurate signals; on timeout
  // the rule-based values are kept.
  privateSemanticAnalysisEnabled: readBoolean('PRIVATE_SEMANTIC_ANALYSIS_ENABLED', true),
  privateSemanticTimeoutMs: readNumber('PRIVATE_SEMANTIC_TIMEOUT_MS', 3000),
  specialUsers: readJson('SPECIAL_USERS_JSON', []),
  memeEnabled: readBoolean('MEME_ENABLED', true),
  memeAutoCollect: readBoolean('MEME_AUTO_COLLECT', true),
  memeAutoSend: readBoolean('MEME_AUTO_SEND', false),
  memeAutoSendMode: readTrimmed('MEME_AUTO_SEND_MODE', ''),
  memeAutoSendCooldownMs: readNumber('MEME_AUTO_SEND_COOLDOWN_MS', 300000),
  memeAutoSendMinScore: readNumber('MEME_AUTO_SEND_MIN_SCORE', 0.72),
  memeAutoSendMaxPerHour: readNumber('MEME_AUTO_SEND_MAX_PER_HOUR', 3),
  memeAutoSendProbability: readProbability('MEME_AUTO_SEND_PROBABILITY', 0.25),
  memeProvider: readTrimmed('MEME_PROVIDER', 'local-cache').toLowerCase(),
  memeImportDir: readTrimmed('MEME_IMPORT_DIR', 'data/qq-favorite-memes'),
  memeFavoritesCount: readNumber('MEME_FAVORITES_COUNT', 48),
  memeFavoritesSyncTtlMs: readNumber('MEME_FAVORITES_SYNC_TTL_MS', 3600000),
  memeVisionEnabled: readBoolean('MEME_VISION_ENABLED', true),
  memeStorageDir: process.env.MEME_STORAGE_DIR || 'data/memes',
  memeEnabledGroups: readJson('MEME_ENABLED_GROUPS', []),
  memeOptOutUsers: readJson('MEME_OPT_OUT_USERS', []),
  memeRequireAdminForAutoMode: readBoolean('MEME_REQUIRE_ADMIN_FOR_AUTO_MODE', true),
});

export function describeHttpBaseUrlProblem(value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '';
  if (!/^https?:\/\//i.test(normalized)) {
    return 'missing-protocol';
  }

  try {
    const url = new URL(normalized);
    if (!url.hostname) return 'missing-host';
  } catch (error) {
    return error.code || 'invalid-url';
  }

  return '';
}

export function validateRuntimeConfig(runtimeConfig = config) {
  const required = [
    ['MONGODB_URI', runtimeConfig.mongodbUri],
    ['LLM_API_KEY/OPENAI_API_KEY/SILICONFLOW_API_KEY/GEMINI_API_KEY', runtimeConfig.llmApiKey],
    ['LLM_CHAT_MODEL', runtimeConfig.llmChatModel],
    ['REPLY_LLM_API_KEY/GEMINI_API_KEY/LLM_API_KEY', runtimeConfig.replyLlmApiKey],
    ['REPLY_LLM_CHAT_MODEL/LLM_CHAT_MODEL', runtimeConfig.replyLlmChatModel],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return { role: 'koishi-embedded' };
}

export function isAdvancedGroup(groupId) {
  return Boolean(config.targetGroupId) && String(groupId) === config.targetGroupId;
}
