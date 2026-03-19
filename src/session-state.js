import { config } from './config.js';
import { Relation, UserState } from './models.js';
import { buildChatScopeId, buildSessionKey } from './chat/session.js';
import { clamp, extractPreferences, uniqueCompact } from './utils.js';

function buildMemorySummary({ preferences, favoriteTopics, activeScore }) {
  const segments = [];

  if (preferences?.length) {
    segments.push(`偏好:${preferences.join(' / ')}`);
  }

  if (favoriteTopics?.length) {
    segments.push(`常聊:${favoriteTopics.join(' / ')}`);
  }

  segments.push(`活跃度:${Math.round(activeScore || 0)}`);
  return segments.join('；');
}

function buildSessionFilter(session) {
  return {
    groupId: buildChatScopeId(session),
    userId: String(session.userId),
  };
}

function buildSessionFields(session) {
  return {
    platform: session.platform,
    chatType: session.chatType,
    chatId: String(session.chatId),
    sessionKey: buildSessionKey(session),
    groupId: buildChatScopeId(session),
    userId: String(session.userId),
  };
}

async function findExistingDoc(Model, session) {
  const sessionKey = buildSessionKey(session);
  let doc = await Model.findOne({ sessionKey });

  if (!doc) {
    doc = await Model.findOne(buildSessionFilter(session));
  }

  if (!doc && session.platform === 'qq' && session.chatType === 'group') {
    doc = await Model.findOne({
      groupId: String(session.chatId),
      userId: String(session.userId),
    });
  }

  if (doc && (doc.sessionKey !== sessionKey || doc.chatId !== String(session.chatId) || doc.platform !== session.platform || doc.chatType !== session.chatType)) {
    const updated = await Model.findOneAndUpdate(
      { _id: doc._id },
      { $set: buildSessionFields(session) },
      { returnDocument: 'after' }
    );
    return updated || doc;
  }

  return doc;
}

export async function ensureRelation(session) {
  const existing = await findExistingDoc(Relation, session);
  if (existing) {
    return existing;
  }

  const baseAffection = String(session.userId) === config.adminQq ? 95 : 30;

  return Relation.findOneAndUpdate(
    buildSessionFilter(session),
    {
      $setOnInsert: {
        ...buildSessionFields(session),
        affection: baseAffection,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
}

export async function ensureUserState(session) {
  const existing = await findExistingDoc(UserState, session);
  if (existing) {
    return existing;
  }

  return UserState.findOneAndUpdate(
    buildSessionFilter(session),
    {
      $setOnInsert: buildSessionFields(session),
    },
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

  const currentAffection = relation.affection ?? 30;
  const nextAffection = clamp(currentAffection + delta, 0, 100);
  const currentActiveScore = relation.activeScore ?? 0;
  const nextActiveScore = clamp((currentActiveScore * 0.65) + 25, 0, 100);
  const nextInteractionCount = (relation.interactionCount || 0) + 1;
  const memorySummary = buildMemorySummary({ preferences, favoriteTopics, activeScore: nextActiveScore });

  const updated = await Relation.findOneAndUpdate(
    { _id: relation._id },
    {
      $set: {
        ...buildSessionFields({
          platform: relation.platform || 'qq',
          chatType: relation.chatType || 'group',
          chatId: relation.chatId || relation.groupId,
          userId: relation.userId,
        }),
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

  if (updated) {
    Object.assign(relation, updated.toObject());
  }

  return updated || relation;
}

export async function updateUserState(userState, emotionResult, analysis) {
  const updated = await UserState.findOneAndUpdate(
    { _id: userState._id },
    {
      $set: {
        ...buildSessionFields({
          platform: userState.platform || 'qq',
          chatType: userState.chatType || 'group',
          chatId: userState.chatId || userState.groupId,
          userId: userState.userId,
        }),
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

  return updated || userState;
}
