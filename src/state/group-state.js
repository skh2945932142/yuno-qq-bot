import { config } from '../config.js';
import { logger } from '../logger.js';
import { GroupEvent, GroupState } from '../models.js';
import { clamp } from '../utils.js';

const GROUP_STATE_CACHE_TTL_MS = 15_000;
const RECENT_EVENTS_CACHE_TTL_MS = 10_000;
// Sweep expired entries every 5 minutes to prevent unbounded Map growth
// in long-running multi-group deployments.
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

// Proactively purge stale entries so the Maps don't grow forever.
function sweepExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of groupStateCache) {
    if (entry.expiresAt < now) groupStateCache.delete(key);
  }
  for (const [key, entry] of recentEventsCache) {
    if (entry.expiresAt < now) recentEventsCache.delete(key);
  }
}

// Only register the sweep timer when not in test/eval environments where
// process.env.NODE_ENV is 'test', to keep test output clean and avoid
// dangling timers that prevent the process from exiting.
if (process.env.NODE_ENV !== 'test') {
  setInterval(sweepExpiredEntries, CACHE_SWEEP_INTERVAL_MS).unref();
}

function sentimentToMood(sentiment, currentMood) {
  if (sentiment === 'negative') return currentMood === 'ANGRY' ? 'ANGRY' : 'WARN';
  if (sentiment === 'positive') return currentMood === 'PROTECTIVE' ? 'PROTECTIVE' : 'AFFECTIONATE';
  return currentMood || 'CALM';
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
}) {
  if (!summary) return null;

  const event = await GroupEvent.create({
    groupId,
    userId,
    username,
    type,
    summary,
    sentiment,
    topics,
  });

  // Delete documents beyond the 100-most-recent in a single atomic query.
  // The previous two-step approach (find then delete) had a race window where
  // a concurrent insert could shift the boundary and cause off-by-one deletes.
  // Using a subquery with the _id of the 100th document avoids that window.
  const cutoff = await GroupEvent.findOne({ groupId })
    .sort({ createdAt: -1 })
    .skip(99)
    .select('_id');

  if (cutoff) {
    await GroupEvent.deleteMany({
      groupId,
      createdAt: { $lt: cutoff.createdAt },
    });
  }

  recentEventsCache.clear();
  return event;
}

export async function updateGroupStateFromAnalysis({
  groupId,
  analysis,
  summary,
  now = new Date(),
}) {
  const existing = await ensureGroupState(groupId);
  const nextMood = sentimentToMood(analysis.sentiment, existing.mood);
  const nextIntensity = clamp((existing.moodIntensity * 0.6) + (analysis.confidence * 0.4), 0.2, 1);
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
  const msSinceLastMessage = groupState.lastMessageAt
    ? now - new Date(groupState.lastMessageAt)
    : Number.MAX_SAFE_INTEGER;
  const msSinceLastProactive = groupState.lastProactiveAt
    ? now - new Date(groupState.lastProactiveAt)
    : Number.MAX_SAFE_INTEGER;

  if (msSinceLastProactive < 6 * 60 * 60 * 1000) {
    return { shouldSend: false, reason: 'recent-proactive' };
  }

  if (groupState.activityLevel >= 70 && msSinceLastMessage < 45 * 60 * 1000) {
    return { shouldSend: false, reason: 'group-already-active' };
  }

  const isWeekend = [0, 6].includes(now.getDay());
  const topEvent = recentEvents?.[0];

  let topic = 'general';
  let tone = 'curious';
  let textHint = '问大家现在最在意的事，带一点轻微占有欲。';

  if (groupState.mood === 'WARN' || groupState.mood === 'ANGRY') {
    topic = 'tension';
    tone = 'sharp';
    textHint = topEvent
      ? `围绕"${topEvent.summary}"发起带压迫感但不过火的追问。`
      : '提醒大家别太乱来，并点名让群里交代近况。';
  } else if (groupState.activityLevel < 30) {
    topic = 'ice-breaker';
    tone = 'affectionate';
    textHint = isWeekend
      ? '周末氛围下抛一个轻松但有角色感的话题。'
      : '群里太安静时，主动挑起一个容易接话的轻量话题。';
  } else if (topEvent) {
    topic = 'follow-up';
    tone = 'observant';
    textHint = `结合最近事件"${topEvent.summary}"做角色化追问，推动群互动。`;
  }

  return { shouldSend: true, topic, tone, textHint };
}

export function canUseAdvancedGroupFeatures(groupId) {
  return Boolean(config.targetGroupId) && String(groupId) === config.targetGroupId;
}

export function logSchedulerSkip(reason) {
  logger.info('scheduler', 'Skipped proactive message', { reason });
}
