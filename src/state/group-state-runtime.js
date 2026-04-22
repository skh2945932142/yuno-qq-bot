import { config } from '../config.js';
import { logger } from '../logger.js';
import { GroupEvent, GroupState } from '../models.js';
import { clamp } from '../utils.js';
import { recordWorkflowMetric } from '../metrics.js';

const GROUP_STATE_CACHE_TTL_MS = 15_000;
const RECENT_EVENTS_CACHE_TTL_MS = 10_000;
const CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const groupStateCache = new Map();
const recentEventsCache = new Map();

function getCached(map, key) {
  const cached = map.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  return cached.value;
}

function setCached(map, key, value, ttlMs) {
  map.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

function sweepExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of groupStateCache) {
    if (entry.expiresAt < now) groupStateCache.delete(key);
  }
  for (const [key, entry] of recentEventsCache) {
    if (entry.expiresAt < now) recentEventsCache.delete(key);
  }
}

function invalidateRecentEventsCache(groupId) {
  const normalizedGroupId = String(groupId || '').trim();
  if (!normalizedGroupId) return;

  for (const key of recentEventsCache.keys()) {
    if (String(key).startsWith(`${normalizedGroupId}:`)) {
      recentEventsCache.delete(key);
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  setInterval(sweepExpiredEntries, CACHE_SWEEP_INTERVAL_MS).unref();
}

function sentimentToMood(sentiment, currentMood) {
  if (sentiment === 'negative') return currentMood === 'ANGRY' ? 'ANGRY' : 'WARN';
  if (sentiment === 'positive') return currentMood === 'PROTECTIVE' ? 'PROTECTIVE' : 'AFFECTIONATE';
  return currentMood || 'CALM';
}

function buildRecentEventSnippet(recentEvents) {
  if (!recentEvents?.length) {
    return 'There was not much group movement recently.';
  }

  return recentEvents
    .slice(0, 2)
    .map((event) => event.summary)
    .join('；');
}

export async function ensureGroupState(groupId) {
  const cached = getCached(groupStateCache, groupId);
  if (cached) {
    return cached;
  }

  const state = await GroupState.findOneAndUpdate(
    { groupId },
    { $setOnInsert: { groupId } },
    { upsert: true, returnDocument: 'after' }
  );
  return setCached(groupStateCache, groupId, state, GROUP_STATE_CACHE_TTL_MS);
}

export async function getRecentEvents(groupId, limit = 5) {
  const cacheKey = `${groupId}:${limit}`;
  const cached = getCached(recentEventsCache, cacheKey);
  if (cached) {
    return cached;
  }

  const events = await GroupEvent.find({ groupId }).sort({ createdAt: -1 }).limit(limit);
  return setCached(recentEventsCache, cacheKey, events, RECENT_EVENTS_CACHE_TTL_MS);
}

export async function recordGroupEvent({
  groupId,
  userId,
  username,
  summary,
  sentiment,
  topics,
  type = 'message',
  eventSource = 'message',
  messageId = '',
  rawText = '',
  keywordHits = [],
  anomalyType = '',
  createdAt = new Date(),
}) {
  if (!summary) return null;

  const event = await GroupEvent.create({
    groupId,
    userId,
    username,
    type,
    eventSource,
    messageId,
    rawText,
    summary,
    sentiment,
    topics,
    keywordHits,
    anomalyType,
    createdAt,
  });

  invalidateRecentEventsCache(groupId);
  return event;
}

export async function cleanupGroupEventsRetention(options = {}, deps = {}) {
  const model = deps.GroupEvent || GroupEvent;
  const retentionCount = Math.max(10, Number(options.retentionCount || config.groupEventRetentionCount || 100));
  const startedAt = Date.now();
  let deletedCount = 0;

  try {
    const groupIds = Array.isArray(options.groupIds)
      ? options.groupIds
      : await model.distinct('groupId');
    const normalizedGroups = groupIds.map((item) => String(item || '').trim()).filter(Boolean);

    for (const groupId of normalizedGroups) {
      const cutoff = await model.findOne({ groupId })
        .sort({ createdAt: -1 })
        .skip(retentionCount - 1)
        .select('createdAt');

      if (!cutoff?.createdAt) {
        continue;
      }

      const result = await model.deleteMany({
        groupId,
        createdAt: { $lt: cutoff.createdAt },
      });
      const deletedForGroup = Number(result?.deletedCount || 0);
      deletedCount += deletedForGroup;

      if (deletedForGroup > 0) {
        invalidateRecentEventsCache(groupId);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    recordWorkflowMetric('yuno_group_event_cleanup_duration_ms', elapsedMs, {
      result: 'success',
    }, 'histogram');

    return {
      groupCount: normalizedGroups.length,
      deletedCount,
      retentionCount,
      elapsedMs,
    };
  } catch (error) {
    recordWorkflowMetric('yuno_group_event_cleanup_duration_ms', Date.now() - startedAt, {
      result: 'error',
    }, 'histogram');
    throw error;
  }
}

export async function updateGroupStateFromAnalysis({
  groupId,
  analysis,
  summary,
  now = new Date(),
}) {
  const existing = await ensureGroupState(groupId);
  const nextMood = sentimentToMood(analysis.sentiment, existing.mood);
  const nextIntensity = clamp((existing.moodIntensity * 0.6) + ((analysis.confidence || 0.4) * 0.4), 0.2, 1);
  const nextActivity = clamp(
    (existing.activityLevel * 0.7) + 18 + Math.min((summary?.length || 0) / 6, 20),
    0,
    100
  );

  const topicSet = [];
  for (const topic of [...(analysis.topics || []), ...(existing.recentTopics || [])]) {
    if (!topic || topicSet.includes(topic)) continue;
    topicSet.push(topic);
    if (topicSet.length >= 5) break;
  }

  const state = await GroupState.findOneAndUpdate(
    { groupId },
    {
      mood: nextMood,
      moodIntensity: nextIntensity,
      activityLevel: nextActivity,
      recentTopics: topicSet,
      lastMessageAt: now,
      lastActiveWindowAt: nextActivity >= 60 ? now : existing.lastActiveWindowAt,
      lastInteractionSummary: summary || existing.lastInteractionSummary,
    },
    { upsert: true, returnDocument: 'after' }
  );
  return setCached(groupStateCache, groupId, state, GROUP_STATE_CACHE_TTL_MS);
}

export async function markProactiveSent(groupId, now = new Date()) {
  const state = await GroupState.findOneAndUpdate(
    { groupId },
    { lastProactiveAt: now },
    { upsert: true, returnDocument: 'after' }
  );
  return setCached(groupStateCache, groupId, state, GROUP_STATE_CACHE_TTL_MS);
}

export function planScheduledInteraction({ groupState, recentEvents, dateContext = new Date() }) {
  if (!groupState) {
    return { shouldSend: false, reason: 'missing-group-state' };
  }

  const now = new Date(dateContext);
  const hour = now.getHours();
  const msSinceLastMessage = groupState.lastMessageAt
    ? now - new Date(groupState.lastMessageAt)
    : Number.MAX_SAFE_INTEGER;
  const msSinceLastProactive = groupState.lastProactiveAt
    ? now - new Date(groupState.lastProactiveAt)
    : Number.MAX_SAFE_INTEGER;
  const recentTopics = groupState.recentTopics?.join(' / ') || 'none';
  const recentEventSnippet = buildRecentEventSnippet(recentEvents);

  if (![7, 23].includes(hour)) {
    return { shouldSend: false, reason: 'unsupported-time-slot' };
  }

  if (msSinceLastProactive < 10 * 60 * 60 * 1000) {
    return { shouldSend: false, reason: 'recent-proactive' };
  }

  if (hour === 7 && groupState.activityLevel >= 60 && msSinceLastMessage < 20 * 60 * 1000) {
    return { shouldSend: false, reason: 'morning-group-already-active' };
  }

  if (hour === 23 && groupState.activityLevel >= 50 && msSinceLastMessage < 30 * 60 * 1000) {
    return { shouldSend: false, reason: 'night-group-still-active' };
  }

  if (hour === 7) {
    return {
      shouldSend: true,
      slot: 'morning',
      topic: 'wake-up',
      tone: 'teasing-care',
      maxLines: 2,
      textHint: `Use a lightly teasing wake-up reminder. Recent topics: ${recentTopics}. You may gently reference this recent snippet: ${recentEventSnippet}.`,
    };
  }

  return {
    shouldSend: true,
    slot: 'night',
    topic: 'sleep-reminder',
    tone: 'gentle-reminder',
    maxLines: 2,
    textHint: `Use a calm bedtime reminder. Recent topics: ${recentTopics}. You may gently reference this recent snippet: ${recentEventSnippet}.`,
  };
}

export function canUseAdvancedGroupFeatures(groupId) {
  return Boolean(config.targetGroupId) && String(groupId) === config.targetGroupId;
}

export function logSchedulerSkip(reason) {
  logger.info('scheduler', 'Skipped proactive message', { reason });
}
