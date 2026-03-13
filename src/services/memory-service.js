import { config } from '../config.js';
import { History, Relation, UserState } from '../models.js';
import { clamp, extractPreferences, uniqueCompact } from '../utils.js';

function buildMemorySummary({ preferences, favoriteTopics, activeScore }) {
  const segments = [];

  if (preferences?.length) {
    segments.push(`偏好:${preferences.join('、')}`);
  }

  if (favoriteTopics?.length) {
    segments.push(`常聊:${favoriteTopics.join('、')}`);
  }

  segments.push(`活跃度:${Math.round(activeScore || 0)}`);
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

  // Compute the new affection clamped value so we can do a bounded $inc via $set.
  // We can't do a bounded $inc directly in MongoDB without a pipeline update, so we
  // read the current value, compute the target, and use findOneAndUpdate with a
  // $set so the write is still a single round-trip and we avoid the stale read that
  // plagued the old mutate-then-save pattern.
  const currentAffection = relation.affection ?? 30;
  const nextAffection = clamp(currentAffection + delta, 0, 100);
  const currentActiveScore = relation.activeScore ?? 0;
  const nextActiveScore = clamp((currentActiveScore * 0.65) + 25, 0, 100);
  const nextInteractionCount = (relation.interactionCount || 0) + 1;
  const memorySummary = buildMemorySummary({ preferences, favoriteTopics, activeScore: nextActiveScore });

  const updated = await Relation.findOneAndUpdate(
    { groupId: relation.groupId, userId: relation.userId },
    {
      $set: {
        affection: nextAffection,
        preferences,
        favoriteTopics,
        activeScore: nextActiveScore,
        interactionCount: nextInteractionCount,
        lastSentiment: analysis.sentiment,
        lastInteract: new Date(),
        memorySummary,
      },
    },
    { returnDocument: 'after' }
  );

  // Keep the in-memory object in sync so callers that already hold a reference
  // see consistent values within the same request lifetime.
  if (updated) {
    Object.assign(relation, updated.toObject());
  }

  return updated ?? relation;
}

export async function updateUserState(userState, emotionResult, analysis) {
  const updated = await UserState.findOneAndUpdate(
    { groupId: userState.groupId, userId: userState.userId },
    {
      $set: {
        currentEmotion: emotionResult.emotion,
        intensity: emotionResult.intensity,
        triggerReason: emotionResult.reason,
        lastIntent: analysis.intent,
        lastSentiment: analysis.sentiment,
        lastUpdated: new Date(),
        decayAt: new Date(Date.now() + 90 * 60 * 1000),
      },
    },
    { returnDocument: 'after' }
  );

  if (updated) {
    Object.assign(userState, updated.toObject());
  }

  return updated ?? userState;
}
