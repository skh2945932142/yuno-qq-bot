import { config } from './config.js';
import { Relation, UserState } from './models.js';
import { buildChatScopeId, buildSessionKey } from './chat/session.js';
import { extractPreferences, uniqueCompact } from './utils.js';
import { getSpecialUserByUserId } from './special-users.js';

// Affection used to be a one-way counter: the delta baseline was +1 and nothing
// decayed, so any user who kept talking reached 100 in about 70 turns and stayed
// there, which flattened every affection-based relationship stage. It now decays
// with silence and can genuinely fall on negative interactions.
const AFFECTION_BASELINE = 30;
const AFFECTION_MAX = 100;
const AFFECTION_DECAY_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const AFFECTION_DECAY_STEP = 1;

function resolveAffectionLowerBound(specialUser = null) {
  return Math.max(AFFECTION_BASELINE, Number(specialUser?.affectionFloor || 0));
}

function countDecaySteps(lastInteract, now) {
  const previous = lastInteract ? new Date(lastInteract).getTime() : Number.NaN;
  if (!Number.isFinite(previous)) return 0;
  const elapsed = now - previous;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.floor(elapsed / AFFECTION_DECAY_INTERVAL_MS);
}

// Read-side decay: callers see the decayed value immediately, but nothing is
// written until the next updateRelationProfile settles it in the pipeline. That
// keeps prompts and tools honest without adding a write to every read.
export function resolveDecayedAffection(relation, now = Date.now(), specialUser = null) {
  const current = Number(relation?.affection ?? AFFECTION_BASELINE);
  if (!Number.isFinite(current)) return AFFECTION_BASELINE;
  const steps = countDecaySteps(relation?.lastInteract, now);
  if (steps <= 0) return current;
  const lowerBound = resolveAffectionLowerBound(
    specialUser || getSpecialUserByUserId(relation?.userId)
  );
  return Math.max(lowerBound, current - (steps * AFFECTION_DECAY_STEP));
}

function buildMemorySummaryPrefix({ preferences, favoriteTopics, specialUser }) {
  const segments = [];

  if (specialUser?.label) {
    segments.push(`特殊对象:${specialUser.label}`);
  }

  if (preferences?.length) {
    segments.push(`偏好:${preferences.join(' / ')}`);
  }

  if (favoriteTopics?.length) {
    segments.push(`常聊:${favoriteTopics.join(' / ')}`);
  }

  return segments.length > 0 ? `${segments.join('；')}；` : '';
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

  if (doc && (
    doc.sessionKey !== sessionKey
    || doc.chatId !== String(session.chatId)
    || doc.platform !== session.platform
    || doc.chatType !== session.chatType
  )) {
    const updated = await Model.findOneAndUpdate(
      { _id: doc._id },
      { $set: buildSessionFields(session) },
      { returnDocument: 'after' }
    );
    return updated || doc;
  }

  return doc;
}

export async function ensureRelation(session, options = {}) {
  const now = Number(options.now || Date.now());
  const specialUser = getSpecialUserByUserId(session.userId);
  const existing = await findExistingDoc(Relation, session);
  if (existing) {
    const affectionFloor = specialUser?.affectionFloor || 0;
    if (affectionFloor > 0 && (existing.affection ?? 0) < affectionFloor) {
      const updated = await Relation.findOneAndUpdate(
        { _id: existing._id },
        { $set: { affection: affectionFloor } },
        { returnDocument: 'after' }
      );
      return updated || existing;
    }
    // Surface the decayed value without writing it; updateRelationProfile
    // settles the same decay against $lastInteract on the next interaction.
    const decayed = resolveDecayedAffection(existing, now, specialUser);
    if (decayed !== existing.affection) {
      existing.affection = decayed;
    }
    return existing;
  }

  const baseAffection = Math.max(
    String(session.userId) === config.adminQq ? 95 : 30,
    specialUser?.affectionFloor || 0
  );

  return Relation.findOneAndUpdate(
    buildSessionFilter(session),
    {
      $setOnInsert: {
        ...buildSessionFields(session),
        affection: baseAffection,
        tags: specialUser ? ['special-user', specialUser.personaMode] : [],
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

export async function updateRelationProfile(relation, { text, analysis }, options = {}) {
  const specialUser = getSpecialUserByUserId(relation.userId);
  const preferences = uniqueCompact([
    // Newly extracted preferences come first: with the old order a full list of
    // six froze permanently and nothing new could ever enter.
    ...extractPreferences(text),
    ...(relation.preferences || []),
  ], 6);

  const favoriteTopics = uniqueCompact([
    ...(analysis.topics || []),
    ...(relation.favoriteTopics || []),
  ], 6);

  let delta = 1;
  if (analysis.sentiment === 'positive') delta += 1;
  if (analysis.sentiment === 'negative') delta -= 3;
  if (analysis.intent === 'help') delta += 1;
  if (analysis.intent === 'challenge') delta -= 1;
  if (relation.userId === config.adminQq) delta += 1;
  if (specialUser) delta += 1;
  if (analysis.ruleSignals?.includes('special-keyword')) delta += 1;
  if (analysis.ruleSignals?.includes('bond-memory-hit')) delta += 1;

  const affectionLowerBound = resolveAffectionLowerBound(specialUser);
  const memorySummaryPrefix = buildMemorySummaryPrefix({
    preferences,
    favoriteTopics,
    specialUser,
  });
  const tags = uniqueCompact([
    ...(relation.tags || []),
    ...(specialUser ? ['special-user', specialUser.personaMode] : []),
  ], 8);
  const now = new Date(Number(options.now || Date.now()));
  const sessionFields = buildSessionFields({
    platform: relation.platform || 'qq',
    chatType: relation.chatType || 'group',
    chatId: relation.chatId || relation.groupId,
    userId: relation.userId,
  });
  // Settle the silence decay in the same pipeline that applies the delta, using
  // the stored $lastInteract rather than the caller's in-memory copy. $max
  // against 0 guards against a lastInteract in the future (clock skew).
  const decayPenalty = {
    $multiply: [
      AFFECTION_DECAY_STEP,
      {
        $max: [
          0,
          {
            $floor: {
              $divide: [
                { $subtract: [now, { $ifNull: ['$lastInteract', now] }] },
                AFFECTION_DECAY_INTERVAL_MS,
              ],
            },
          },
        ],
      },
    ],
  };

  const updated = await Relation.findOneAndUpdate(
    { _id: relation._id },
    [
      {
        $set: {
          ...sessionFields,
          affection: {
            $max: [
              affectionLowerBound,
              {
                $min: [
                  AFFECTION_MAX,
                  {
                    $add: [
                      {
                        $subtract: [
                          { $ifNull: ['$affection', affectionLowerBound] },
                          decayPenalty,
                        ],
                      },
                      delta,
                    ],
                  },
                ],
              },
            ],
          },
          preferences: { $literal: preferences },
          favoriteTopics: { $literal: favoriteTopics },
          activeScore: {
            $min: [
              100,
              {
                $add: [
                  { $multiply: [{ $ifNull: ['$activeScore', 0] }, 0.65] },
                  specialUser ? 28 : 25,
                ],
              },
            ],
          },
          interactionCount: { $add: [{ $ifNull: ['$interactionCount', 0] }, 1] },
          lastSentiment: analysis.sentiment,
          lastInteract: now,
          tags: { $literal: tags },
        },
      },
      {
        $set: {
          memorySummary: {
            $concat: [
              memorySummaryPrefix,
              '活跃度 ',
              { $toString: { $round: ['$activeScore', 0] } },
            ],
          },
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true }
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
