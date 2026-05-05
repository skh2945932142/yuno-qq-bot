import { config } from './config.js';

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_MIN_SCORE = 0.72;
const DEFAULT_MAX_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

const cooldownState = new Map();

const playfulTriggers = [
  '破防',
  '笑死',
  '绷不住',
  '典',
  '急了',
  '草',
  '离谱',
  '乐',
  '哈哈',
  '乐子',
  '嘴硬',
  '地铁老人',
];

const seriousSignals = [
  '救命',
  '崩溃',
  '难受',
  '抑郁',
  '自杀',
  '想死',
  '怎么办',
  '报错',
  '代码',
  '配置',
  '隐私',
  '手机号',
  '地址',
];

function normalizeMode(settings = {}) {
  const raw = String(settings.memeAutoSendMode || '').trim().toLowerCase();
  if (['off', 'suggest', 'auto'].includes(raw)) {
    return raw;
  }
  return settings.memeAutoSend ? 'auto' : 'off';
}

function listIncludesString(list, value) {
  return Array.isArray(list) && list.map((item) => String(item)).includes(String(value));
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function getAssetPath(asset = {}) {
  return asset.storagePath || asset.imageUrl || '';
}

function normalizeCandidate(asset) {
  if (!asset || asset.disabled) {
    return null;
  }
  if (asset.safetyStatus && asset.safetyStatus !== 'safe') {
    return null;
  }
  if (!getAssetPath(asset)) {
    return null;
  }
  return asset;
}

function scoreCandidate(asset, contextText, replyText, analysis = {}) {
  const haystack = `${contextText} ${replyText}`.toLowerCase();
  const tags = [
    ...(Array.isArray(asset.semanticTags) ? asset.semanticTags : []),
    ...(Array.isArray(asset.tags) ? asset.tags : []),
    asset.usageContext || '',
    asset.caption || '',
  ].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);

  let score = 0.55;
  if (hasAny(contextText, playfulTriggers)) score += 0.25;
  if (String(analysis.sentiment || '').toLowerCase() === 'positive') score += 0.08;
  if (String(analysis.intent || '').toLowerCase() === 'chat') score += 0.05;

  for (const tag of tags) {
    if (tag && haystack.includes(tag)) {
      score += 0.12;
      break;
    }
  }

  if (Number(asset.usageCount || 0) > 0) {
    score += Math.min(Number(asset.usageCount || 0), 3) * 0.02;
  }

  return Math.min(1, Number(score.toFixed(3)));
}

function pruneCooldown(nowMs) {
  for (const [key, state] of cooldownState.entries()) {
    if (nowMs - state.lastAt > HOUR_MS) {
      cooldownState.delete(key);
    }
  }
}

function checkCooldown({ chatId, userId, assetId, nowMs, cooldownMs, maxPerHour }) {
  pruneCooldown(nowMs);
  const keys = [
    `chat:${chatId}`,
    `user:${chatId}:${userId}`,
    `asset:${chatId}:${assetId}`,
  ];

  for (const key of keys) {
    const state = cooldownState.get(key);
    if (!state) continue;
    if (nowMs - state.lastAt < cooldownMs) {
      return { allowed: false, reason: 'cooldown' };
    }
    if ((state.hourCount || 0) >= maxPerHour && nowMs - state.hourStart < HOUR_MS) {
      return { allowed: false, reason: 'hourly-limit' };
    }
  }

  return { allowed: true, reason: 'ok' };
}

function recordCooldown({ chatId, userId, assetId, nowMs }) {
  const keys = [
    `chat:${chatId}`,
    `user:${chatId}:${userId}`,
    `asset:${chatId}:${assetId}`,
  ];

  for (const key of keys) {
    const current = cooldownState.get(key);
    if (!current || nowMs - current.hourStart >= HOUR_MS) {
      cooldownState.set(key, { lastAt: nowMs, hourStart: nowMs, hourCount: 1 });
    } else {
      cooldownState.set(key, {
        lastAt: nowMs,
        hourStart: current.hourStart,
        hourCount: current.hourCount + 1,
      });
    }
  }
}

export function resetMemeReplyPlannerState() {
  cooldownState.clear();
}

export function planContextualMemeReply({
  event = {},
  route = {},
  analysis = {},
  replyText = '',
  memeCandidates = [],
  userProfile = {},
  settings = config,
  now = new Date(),
} = {}) {
  const mode = normalizeMode(settings);
  if (!(settings.memeEnabled ?? true)) {
    return { shouldSend: false, suggested: false, reason: 'disabled', mode };
  }
  if (mode === 'off') {
    return { shouldSend: false, suggested: false, reason: 'mode-off', mode };
  }
  if (userProfile?.memeOptOut || listIncludesString(settings.memeOptOutUsers, event.userId)) {
    return { shouldSend: false, suggested: false, reason: 'user-opt-out', mode };
  }
  if (
    event.chatType === 'group'
    && Array.isArray(settings.memeEnabledGroups)
    && settings.memeEnabledGroups.length > 0
    && !listIncludesString(settings.memeEnabledGroups, event.chatId)
  ) {
    return { shouldSend: false, suggested: false, reason: 'group-not-enabled', mode };
  }
  if (route.category === 'knowledge_qa' || route.type === 'tool') {
    return { shouldSend: false, suggested: false, reason: 'serious-route', mode };
  }

  const contextText = String(event.rawText || event.text || '').trim();
  const normalizedText = contextText.toLowerCase();
  if (hasAny(normalizedText, seriousSignals) && !hasAny(normalizedText, playfulTriggers)) {
    return { shouldSend: false, suggested: false, reason: 'serious-context', mode };
  }
  if (event.chatType === 'group' && !event.mentionsBot && !hasAny(normalizedText, playfulTriggers)) {
    return { shouldSend: false, suggested: false, reason: 'group-not-explicit', mode };
  }

  const candidates = (Array.isArray(memeCandidates) ? memeCandidates : [])
    .map(normalizeCandidate)
    .filter(Boolean)
    .map((asset) => ({
      asset,
      score: scoreCandidate(asset, normalizedText, replyText, analysis),
    }))
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return { shouldSend: false, suggested: false, reason: 'no-candidate', mode };
  }

  const best = candidates[0];
  const minScore = Number(settings.memeAutoSendMinScore || DEFAULT_MIN_SCORE);
  if (best.score < minScore) {
    return {
      shouldSend: false,
      suggested: false,
      reason: 'low-score',
      mode,
      asset: best.asset,
      score: best.score,
    };
  }

  if (mode === 'suggest') {
    return {
      shouldSend: false,
      suggested: true,
      reason: 'suggest-only',
      mode,
      asset: best.asset,
      score: best.score,
    };
  }

  if (!settings.memeAutoSend) {
    return {
      shouldSend: false,
      suggested: true,
      reason: 'auto-send-disabled',
      mode,
      asset: best.asset,
      score: best.score,
    };
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cooldown = checkCooldown({
    chatId: event.chatId,
    userId: event.userId,
    assetId: best.asset.assetId,
    nowMs,
    cooldownMs: Number(settings.memeAutoSendCooldownMs || DEFAULT_COOLDOWN_MS),
    maxPerHour: Number(settings.memeAutoSendMaxPerHour || DEFAULT_MAX_PER_HOUR),
  });
  if (!cooldown.allowed) {
    return {
      shouldSend: false,
      suggested: true,
      reason: cooldown.reason,
      mode,
      asset: best.asset,
      score: best.score,
    };
  }

  return {
    shouldSend: true,
    suggested: true,
    reason: 'high-semantic-match',
    mode,
    asset: best.asset,
    score: best.score,
    recordSent: () => recordCooldown({
      chatId: event.chatId,
      userId: event.userId,
      assetId: best.asset.assetId,
      nowMs,
    }),
  };
}
