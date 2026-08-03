import { config } from './config.js';
import { chat } from './minimax.js';
import { recordWorkflowMetric } from './metrics.js';
import { hashRetrievalCacheKey, retrievalCache } from './retrieval-cache.js';
import { safeJsonParse, stripCqCodes } from './utils.js';

const MEMORY_QUERY_PATTERN = /(?:记得我|还记得|我(?:之前|上次).{0,12}(?:说过|提过)|我的(?:偏好|宠物|生日|考试|面试)|remember me|what did i say)/i;

function compactText(value, limit) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

export function isMemoryQuery(text) {
  return MEMORY_QUERY_PATTERN.test(String(text || ''));
}

function fallbackQuery(text, reason = 'raw-query') {
  return {
    query: String(text || '').trim(),
    keywords: [],
    memoryIntent: isMemoryQuery(text),
    rewritten: false,
    reason,
  };
}

function normalizeRewrite(parsed, original) {
  const query = compactText(parsed?.query || parsed?.rewrittenQuery || '', 240);
  const confidence = Number(parsed?.confidence);
  if (!query || (Number.isFinite(confidence) && confidence < 0.55)) {
    return fallbackQuery(original, 'low-confidence-rewrite');
  }
  const keywords = Array.isArray(parsed?.keywords)
    ? parsed.keywords.map((item) => compactText(item, 48)).filter(Boolean).slice(0, 8)
    : [];
  return {
    query,
    keywords,
    memoryIntent: typeof parsed?.memoryIntent === 'boolean' ? parsed.memoryIntent : isMemoryQuery(original),
    rewritten: query !== String(original || '').trim(),
    reason: 'rewritten',
  };
}

export async function rewriteRetrievalQuery({
  event = {},
  route = {},
  userTurn = '',
  conversationState = {},
  recentEvents = [],
} = {}, deps = {}) {
  const runtimeConfig = deps.config || config;
  const raw = stripCqCodes(userTurn || event.rawText || event.text || '');
  if (!raw) return fallbackQuery('', 'empty-query');
  if (!route?.retrievalMode || route.retrievalMode === 'none') return fallbackQuery(raw, 'fast-path');
  if (runtimeConfig.retrievalQueryRewriteEnabled === false) return fallbackQuery(raw, 'rewrite-disabled');

  const cache = deps.cache || retrievalCache;
  const cacheKey = hashRetrievalCacheKey([
    'query-rewrite/v1',
    event.chatType,
    event.chatId,
    event.userId,
    raw,
    compactText(conversationState?.rollingSummary, 240),
    (recentEvents || []).slice(0, 4).map((item) => compactText(item?.summary, 96)),
  ]);
  const cached = await cache.get(cacheKey);
  if (cached) {
    recordWorkflowMetric('yuno_retrieval_cache_hit_total', 1, { source: 'query-rewrite' });
    return cached;
  }

  const recentConversation = (conversationState?.messages || [])
    .slice(-4)
    .map((item) => `${item.role === 'assistant' ? 'Bot' : 'User'}: ${compactText(item.content, 100)}`)
    .join('\n');
  const groupContext = (recentEvents || [])
    .slice(0, 4)
    .reverse()
    .map((item) => `${compactText(item.username || item.userId, 16) || '群友'}: ${compactText(item.summary, 100)}`)
    .join('\n');
  const prompt = [
    '你负责把 QQ 中简短、口语化、含指代的提问改写成可检索的中文查询。',
    '只返回 JSON：{"query":"...","keywords":["..."],"memoryIntent":true|false,"confidence":0-1}。',
    '不要添加用户未表达的事实；上下文不足时保留原意。',
    `当前消息：${raw}`,
    event.replyToText ? `引用消息：${compactText(event.replyToText, 160)}` : '',
    recentConversation ? `同会话近期内容：\n${recentConversation}` : '',
    groupContext ? `近期群聊：\n${groupContext}` : '',
  ].filter(Boolean).join('\n\n');

  try {
    const invoke = deps.chat || chat;
    const output = await invoke([], '只输出合法 JSON，不要解释。', prompt, {
      temperature: 0,
      maxTokens: 180,
      timeoutMs: runtimeConfig.retrievalQueryRewriteTimeoutMs,
      retries: 0,
      operation: 'retrieval-query-rewrite',
    });
    const result = normalizeRewrite(safeJsonParse(output), raw);
    await cache.set(cacheKey, result, runtimeConfig.retrievalQueryRewriteCacheTtlMs);
    recordWorkflowMetric('yuno_retrieval_query_rewrites_total', 1, { result: result.rewritten ? 'rewritten' : 'fallback' });
    return result;
  } catch {
    const result = fallbackQuery(raw, 'rewrite-failed');
    recordWorkflowMetric('yuno_retrieval_query_rewrites_total', 1, { result: 'error' });
    return result;
  }
}
