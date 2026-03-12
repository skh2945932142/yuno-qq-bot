import { config } from '../config.js';
import { History, Relation, UserState } from '../models.js';
import { clamp, extractPreferences, uniqueCompact } from '../utils.js';

function buildMemorySummary(relation) {
  const segments = [];

  if (relation.preferences?.length) {
    segments.push(`偏好:${relation.preferences.join('、')}`);
  }

  if (relation.favoriteTopics?.length) {
    segments.push(`常聊:${relation.favoriteTopics.join('、')}`);
  }

  segments.push(`活跃度:${Math.round(relation.activeScore || 0)}`);
  return segments.join('；');
}

export async function ensureRelation(groupId, userId) {
  const baseAffection = userId === config.adminQq ? 95 : 30;
  return Relation.findOneAndUpdate(
    { groupId, userId },
    {
      $setOnInsert: {
        groupId,
        userId,
        affection: baseAffection,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
}

export async function ensureUserState(groupId, userId) {
  return UserState.findOneAndUpdate(
    { groupId, userId },
    {
      $setOnInsert: {
        groupId,
        userId,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
}

export async function getHistory(groupId, userId) {
  const historyDoc = await History.findOne({ groupId, userId });
  return historyDoc?.messages || [];
}

export async function saveHistory(groupId, userId, messages) {
  return History.findOneAndUpdate(
    { groupId, userId },
    { messages: messages.slice(-40) },
    { upsert: true, returnDocument: 'after' }
  );
}

export async function updateRelationProfile(relation, { text, analysis }) {
  const preferences = uniqueCompact([
    ...(relation.preferences || []),
    ...extractPreferences(text),
  ], 6);
  const favoriteTopics = uniqueCompact([
    ...(analysis.topics || []),
    ...(relation.favoriteTopics || []),
  ], 6);

  let delta = 1;
  if (analysis.sentiment === 'positive') delta += 1;
  if (analysis.sentiment === 'negative') delta -= 2;
  if (analysis.intent === 'help') delta += 1;
  if (analysis.intent === 'challenge') delta -= 1;
  if (relation.userId === config.adminQq) delta += 1;

  relation.affection = clamp(relation.affection + delta, 0, 100);
  relation.preferences = preferences;
  relation.favoriteTopics = favoriteTopics;
  relation.activeScore = clamp((relation.activeScore * 0.65) + 25, 0, 100);
  relation.interactionCount = (relation.interactionCount || 0) + 1;
  relation.lastSentiment = analysis.sentiment;
  relation.lastInteract = new Date();
  relation.memorySummary = buildMemorySummary(relation);

  await relation.save();
  return relation;
}

export async function updateUserState(userState, emotionResult, analysis) {
  userState.currentEmotion = emotionResult.emotion;
  userState.intensity = emotionResult.intensity;
  userState.triggerReason = emotionResult.reason;
  userState.lastIntent = analysis.intent;
  userState.lastSentiment = analysis.sentiment;
  userState.lastUpdated = new Date();
  userState.decayAt = new Date(Date.now() + 90 * 60 * 1000);
  await userState.save();
  return userState;
}
