import { config } from '../config.js';
import { logger } from '../logger.js';
import { GroupEvent, GroupState } from '../models.js';
import { clamp } from '../utils.js';

function sentimentToMood(sentiment, currentMood) {
  if (sentiment === 'negative') return currentMood === 'ANGRY' ? 'ANGRY' : 'WARN';
  if (sentiment === 'positive') return currentMood === 'PROTECTIVE' ? 'PROTECTIVE' : 'AFFECTIONATE';
  return currentMood || 'CALM';
}

export async function ensureGroupState(groupId) {
  return GroupState.findOneAndUpdate(
    { groupId },
    { $setOnInsert: { groupId } },
    { upsert: true, returnDocument: 'after' }
  );
}

export async function getRecentEvents(groupId, limit = 5) {
  return GroupEvent.find({ groupId }).sort({ createdAt: -1 }).limit(limit);
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

  const staleEvents = await GroupEvent.find({ groupId })
    .sort({ createdAt: -1 })
    .skip(100)
    .select('_id');

  if (staleEvents.length > 0) {
    await GroupEvent.deleteMany({ _id: { $in: staleEvents.map((item) => item._id) } });
  }

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

  return GroupState.findOneAndUpdate(
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
}

export async function markProactiveSent(groupId, now = new Date()) {
  return GroupState.findOneAndUpdate(
    { groupId },
    { lastProactiveAt: now },
    { upsert: true, returnDocument: 'after' }
  );
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
      ? `围绕“${topEvent.summary}”发起带压迫感但不过火的追问。`
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
    textHint = `结合最近事件“${topEvent.summary}”做角色化追问，推动群互动。`;
  }

  return { shouldSend: true, topic, tone, textHint };
}

export function canUseAdvancedGroupFeatures(groupId) {
  return Boolean(config.targetGroupId) && String(groupId) === config.targetGroupId;
}

export function logSchedulerSkip(reason) {
  logger.info('scheduler', 'Skipped proactive message', { reason });
}
