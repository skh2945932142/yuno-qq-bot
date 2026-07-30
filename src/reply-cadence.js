import { config } from './config.js';
import { clamp, stripCqCodes } from './utils.js';

const BUDGET_HEADROOM_MS = 800;
const FAST_EMOTIONS = new Set(['IRRITABLE', 'ANGRY', 'WARN']);
const SLOW_EMOTIONS = new Set(['SAD', 'DISTANT', 'CALM_DISTANT']);

function readNumberOption(value, fallback, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value || 'yuno-cadence')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed) {
  let state = hashSeed(seed) || 1;
  return function next() {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function resolveCadenceSettings(runtimeConfig = config) {
  const source = runtimeConfig || config;
  return {
    enabled: source.replyCadenceEnabled ?? config.replyCadenceEnabled ?? true,
    readMsPerChar: readNumberOption(source.replyCadenceReadMsPerChar, 12),
    readMaxMs: readNumberOption(source.replyCadenceReadMaxMs, 1200),
    minPreDelayMs: readNumberOption(source.replyCadenceMinPreDelayMs, 350),
    maxPreDelayMs: readNumberOption(source.replyCadenceMaxPreDelayMs, 1800),
    typingMsPerChar: readNumberOption(source.replyCadenceTypingMsPerChar, 70),
    typingMaxMs: readNumberOption(source.replyCadenceTypingMaxMs, 2600),
    jitterRatio: clamp(readNumberOption(source.replyCadenceJitterRatio, 0.25), 0, 1),
    segmentMinDelayMs: readNumberOption(source.replySegmentMinDelayMs, 600),
  };
}

function resolveBaselineMs(event, route) {
  if (event?.chatType === 'private') return 520;
  if (route?.category === 'poke') return 260;
  return 700;
}

function inboundLength(event) {
  const raw = String(event?.rawText ?? event?.text ?? '');
  return stripCqCodes(raw).length;
}

function applyJitter(value, jitterRatio, random) {
  if (value <= 0 || jitterRatio <= 0) return Math.round(value);
  const offset = (random() * 2 - 1) * jitterRatio;
  return Math.round(value * (1 + offset));
}

function resolveEmotionFactor({ route, emotionResult, dailyMood }) {
  const emotion = String(emotionResult?.emotion || '').toUpperCase();
  const moodKey = String(dailyMood?.key || '').toUpperCase();
  if (FAST_EMOTIONS.has(emotion) || route?.category === 'poke' || moodKey.includes('IRRITABLE')) {
    return 0.6;
  }
  if (SLOW_EMOTIONS.has(emotion) || route?.category === 'knowledge_qa') {
    return 1.3;
  }
  return 1;
}

export function resolveReplyCadence({
  event = {},
  route = null,
  replyPlan = null,
  emotionResult = null,
  dailyMood = null,
  segments = [],
  remainingBudgetMs = null,
  runtimeConfig = config,
  random = null,
} = {}) {
  const settings = resolveCadenceSettings(runtimeConfig);
  const normalizedSegments = (Array.isArray(segments) ? segments : [])
    .map((segment) => String(segment || ''));
  const emptyPlan = {
    preDelayMs: 0,
    segmentDelays: normalizedSegments.map(() => 0),
    reason: 'disabled',
  };

  if (!settings.enabled) return emptyPlan;

  const rng = typeof random === 'function'
    ? random
    : createSeededRandom(`${event.chatId || 'chat'}:${event.messageId || event.timestamp || '0'}`);
  const readMs = Math.min(settings.readMaxMs, inboundLength(event) * settings.readMsPerChar);
  const emotionFactor = resolveEmotionFactor({ route, emotionResult, dailyMood });
  const depthFactor = replyPlan?.depth === 'long' ? 1.1 : 1;
  const rawPreDelay = (resolveBaselineMs(event, route) + readMs) * emotionFactor * depthFactor;
  let preDelayMs = clamp(
    applyJitter(rawPreDelay, settings.jitterRatio, rng),
    settings.minPreDelayMs,
    Math.max(settings.minPreDelayMs, settings.maxPreDelayMs)
  );

  let segmentDelays = normalizedSegments.map((segment, index) => {
    if (index === 0) return 0;
    const raw = segment.length * settings.typingMsPerChar;
    return clamp(
      applyJitter(raw, settings.jitterRatio, rng),
      settings.segmentMinDelayMs,
      Math.max(settings.segmentMinDelayMs, settings.typingMaxMs)
    );
  });

  let reason = 'cadence';
  const budget = Number(remainingBudgetMs);
  if (Number.isFinite(budget) && budget > 0) {
    const total = preDelayMs + segmentDelays.reduce((sum, value) => sum + value, 0);
    const allowance = budget - BUDGET_HEADROOM_MS;
    if (allowance <= 0) {
      preDelayMs = 0;
      segmentDelays = segmentDelays.map(() => 0);
      reason = 'budget-collapsed';
    } else if (total > allowance) {
      const ratio = allowance / total;
      preDelayMs = Math.round(preDelayMs * ratio);
      segmentDelays = segmentDelays.map((value) => Math.round(value * ratio));
      reason = 'budget-compressed';
    }
  }

  return {
    preDelayMs: Math.max(0, Math.round(preDelayMs)),
    segmentDelays: segmentDelays.map((value) => Math.max(0, Math.round(value))),
    reason,
  };
}

export function sleep(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delay));
}
