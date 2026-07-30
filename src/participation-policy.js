import { config } from './config.js';
import { createSeededRandom } from './reply-cadence.js';
import { parseCommand } from './command-parser.js';
import { stripCqCodes } from './utils.js';
import { recordWorkflowMetric } from './metrics.js';

const CONSECUTIVE_REPLY_WINDOW_MS = 60000;
const EXPLICIT_REASONS = new Set([
  'private-default-reply',
  'special-private-reply',
  'poke-trigger',
  'command-trigger',
  'admin-command-pass',
  'advanced-direct-mention-pass',
  'basic-direct-mention-pass',
  'tool-fallback',
]);
const EXPLICIT_SIGNALS = new Set([
  'direct-mention',
  'reply-to-bot',
  'poke',
  'command',
]);
const PUNCTUATION_ONLY_REGEX = /^[\s\p{P}\p{S}]+$/u;
const EMOJI_ONLY_REGEX = /^(?:[\s\p{Extended_Pictographic}\uFE0F\u200D]|\p{P})+$/u;

const STREAK_MAP_LIMIT = 2000;
const AMBIENT_MAP_LIMIT = 500;

const replyStreaks = new Map();
const ambientState = new Map();

// Both maps are process-local and unbounded by nature, so drop the oldest
// entries once they grow past a safe ceiling.
function pruneMap(map, limit) {
  if (map.size <= limit) return;
  const overflow = map.size - limit;
  let removed = 0;
  for (const key of map.keys()) {
    map.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function readNumberOption(value, fallback, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function resolveSettings(runtimeConfig = config) {
  const source = runtimeConfig || config;
  return {
    skipProbability: readNumberOption(source.participationSkipProbability, 0.12),
    reactionProbability: readNumberOption(source.participationReactionProbability, 0.18),
    maxConsecutiveReplies: Math.max(1, Math.round(readNumberOption(source.participationMaxConsecutiveReplies, 2, 1))),
    ambientEnabled: source.ambientJoinEnabled ?? config.ambientJoinEnabled ?? false,
    ambientProbability: readNumberOption(source.ambientJoinProbability, 0.02),
    ambientCooldownMs: readNumberOption(source.ambientJoinCooldownMs, 600000),
    ambientMaxPerDay: Math.max(0, Math.round(readNumberOption(source.ambientJoinMaxPerDay, 6))),
    targetGroupId: String(source.targetGroupId ?? config.targetGroupId ?? '').trim(),
  };
}

function buildRandom(event, salt, random) {
  if (typeof random === 'function') return random;
  return createSeededRandom(`${salt}:${event?.chatId || 'chat'}:${event?.messageId || event?.timestamp || '0'}`);
}

function normalizedInboundText(event = {}) {
  return stripCqCodes(String(event.rawText ?? event.text ?? '')).trim();
}

function hasExplicitTrigger(event = {}, analysis = {}) {
  if (event.chatType === 'private') return true;
  if (event.mentionsBot) return true;
  const reason = String(analysis.reason || '');
  if (EXPLICIT_REASONS.has(reason)) return true;
  const signals = Array.isArray(analysis.ruleSignals) ? analysis.ruleSignals : [];
  if (signals.some((signal) => EXPLICIT_SIGNALS.has(String(signal)))) return true;
  return Boolean(parseCommand(normalizedInboundText(event)));
}

function isLowInformationInbound(event = {}) {
  const text = normalizedInboundText(event);
  if (!text) return (event.attachments || []).length === 0;
  if (text.length <= 2) return true;
  if (PUNCTUATION_ONLY_REGEX.test(text)) return true;
  return EMOJI_ONLY_REGEX.test(text);
}

function streakKey(event = {}) {
  return `${event.chatId || 'chat'}:${event.userId || 'user'}`;
}

export function recordParticipationReply(event = {}, now = Date.now()) {
  const key = streakKey(event);
  const current = replyStreaks.get(key);
  replyStreaks.delete(key);
  const next = !current || now - current.lastAt > CONSECUTIVE_REPLY_WINDOW_MS
    ? { count: 1, lastAt: now }
    : { count: current.count + 1, lastAt: now };
  replyStreaks.set(key, next);
  pruneMap(replyStreaks, STREAK_MAP_LIMIT);
  return next.count;
}

function currentStreak(event = {}, now = Date.now()) {
  const current = replyStreaks.get(streakKey(event));
  if (!current) return 0;
  if (now - current.lastAt > CONSECUTIVE_REPLY_WINDOW_MS) return 0;
  return current.count;
}

export function resolveParticipationDecision({
  event = {},
  analysis = {},
  relation = null,
  groupState = null,
  now = Date.now(),
  runtimeConfig = config,
  random = null,
} = {}) {
  const settings = resolveSettings(runtimeConfig);
  const explicit = hasExplicitTrigger(event, analysis);
  if (explicit) {
    return { mode: 'reply', reason: 'explicit-trigger' };
  }

  const rng = buildRandom(event, 'participation', random);
  const relevance = Number(analysis.relevance || 0);

  if (isLowInformationInbound(event)) {
    return rng() < settings.reactionProbability
      ? { mode: 'reaction', reason: 'low-information-inbound' }
      : { mode: 'skip', reason: 'low-information-inbound' };
  }

  const streak = currentStreak(event, now);
  if (streak >= settings.maxConsecutiveReplies) {
    return rng() < settings.reactionProbability
      ? { mode: 'reaction', reason: 'consecutive-reply-limit' }
      : { mode: 'skip', reason: 'consecutive-reply-limit' };
  }

  if (relevance < 0.5 && rng() < settings.skipProbability) {
    return { mode: 'skip', reason: 'low-relevance-sampling' };
  }

  return { mode: 'reply', reason: 'default-reply' };
}

function ambientDayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function denyAmbient(reason) {
  return { allowed: false, reason };
}

export function resolveAmbientJoinDecision(input = {}) {
  const decision = evaluateAmbientJoinDecision(input);
  if (decision.allowed || decision.reason === 'ambient-not-sampled') {
    recordWorkflowMetric('yuno_ambient_join_total', 1, {
      result: decision.allowed ? 'allowed' : 'not-sampled',
    });
  }
  return decision;
}

function evaluateAmbientJoinDecision({
  event = {},
  groupState = null,
  now = Date.now(),
  runtimeConfig = config,
  random = null,
} = {}) {
  const settings = resolveSettings(runtimeConfig);
  if (!settings.ambientEnabled || settings.ambientProbability <= 0) {
    return denyAmbient('ambient-disabled');
  }
  if (event.chatType !== 'group') {
    return denyAmbient('not-group');
  }
  if (!settings.targetGroupId || String(event.chatId) !== settings.targetGroupId) {
    return denyAmbient('not-target-group');
  }
  if (!normalizedInboundText(event)) {
    return denyAmbient('empty-inbound');
  }
  if (Number(groupState?.activityLevel || 0) < 25) {
    return denyAmbient('group-idle');
  }

  const key = String(event.chatId);
  const state = ambientState.get(key) || { lastAt: 0, dayKey: '', count: 0 };
  const dayKey = ambientDayKey(now);
  const dailyCount = state.dayKey === dayKey ? state.count : 0;
  if (settings.ambientMaxPerDay > 0 && dailyCount >= settings.ambientMaxPerDay) {
    return denyAmbient('ambient-daily-limit');
  }
  if (state.lastAt && now - state.lastAt < settings.ambientCooldownMs) {
    return denyAmbient('ambient-cooldown');
  }

  const rng = buildRandom(event, 'ambient', random);
  if (rng() >= settings.ambientProbability) {
    return denyAmbient('ambient-not-sampled');
  }

  ambientState.delete(key);
  ambientState.set(key, { lastAt: now, dayKey, count: dailyCount + 1 });
  pruneMap(ambientState, AMBIENT_MAP_LIMIT);
  return { allowed: true, reason: 'ambient-join' };
}

export function resetParticipationState() {
  replyStreaks.clear();
  ambientState.clear();
}
