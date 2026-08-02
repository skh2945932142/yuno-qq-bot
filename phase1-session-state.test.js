import test from 'node:test';
import assert from 'node:assert/strict';
import { Relation } from './src/models.js';
import { resolveDecayedAffection, updateRelationProfile } from './src/session-state.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function readAffectionExpression(update) {
  return update[0].$set.affection;
}

function readDelta(update) {
  return readAffectionExpression(update).$max[1].$min[1].$add[1];
}

function readLowerBound(update) {
  return readAffectionExpression(update).$max[0];
}

async function captureRelationUpdate(relationOverrides, payload) {
  const original = Relation.findOneAndUpdate;
  const relation = {
    _id: 'rel-1',
    platform: 'qq',
    chatType: 'group',
    chatId: 'group-1',
    groupId: 'group-1',
    userId: 'user-1',
    preferences: [],
    favoriteTopics: [],
    tags: [],
    ...relationOverrides,
  };

  try {
    let received = null;
    Relation.findOneAndUpdate = async (_filter, update) => {
      received = update;
      return { toObject: () => ({ ...relation }) };
    };
    await updateRelationProfile(relation, payload);
    return received;
  } finally {
    Relation.findOneAndUpdate = original;
  }
}

test('resolveDecayedAffection drops one point per three silent days', () => {
  const now = Date.now();
  assert.equal(resolveDecayedAffection({ affection: 90, lastInteract: new Date(now) }, now), 90);
  assert.equal(resolveDecayedAffection({ affection: 90, lastInteract: new Date(now - 2 * DAY_MS) }, now), 90);
  assert.equal(resolveDecayedAffection({ affection: 90, lastInteract: new Date(now - 3 * DAY_MS) }, now), 89);
  assert.equal(resolveDecayedAffection({ affection: 90, lastInteract: new Date(now - 30 * DAY_MS) }, now), 80);
});

test('resolveDecayedAffection never falls below the baseline floor', () => {
  const now = Date.now();
  const ancient = { affection: 100, lastInteract: new Date(now - 3650 * DAY_MS) };
  assert.equal(resolveDecayedAffection(ancient, now), 30);
});

test('resolveDecayedAffection ignores missing or future timestamps', () => {
  const now = Date.now();
  assert.equal(resolveDecayedAffection({ affection: 77 }, now), 77);
  assert.equal(resolveDecayedAffection({ affection: 77, lastInteract: new Date(now + 10 * DAY_MS) }, now), 77);
});

test('negative sentiment produces a net affection loss for ordinary users', async () => {
  const update = await captureRelationUpdate({}, {
    text: '我讨厌这样',
    analysis: { topics: [], sentiment: 'negative', intent: 'chat', ruleSignals: [] },
  });

  // Baseline +1 with a -3 negative penalty; the old -2 penalty left admins and
  // special users unable to ever lose affection.
  assert.equal(readDelta(update), -2);
});

test('affection update settles silence decay against the stored lastInteract', async () => {
  const update = await captureRelationUpdate({}, {
    text: '在吗',
    analysis: { topics: [], sentiment: 'neutral', intent: 'chat', ruleSignals: [] },
  });

  const decayed = readAffectionExpression(update).$max[1].$min[1].$add[0];
  assert.ok(decayed.$subtract, 'affection must subtract a decay penalty');
  const penalty = decayed.$subtract[1];
  assert.equal(JSON.stringify(penalty).includes('$lastInteract'), true);
  assert.equal(readLowerBound(update), 30);
});

test('newly extracted preferences take priority over a full stored list', async () => {
  const update = await captureRelationUpdate({
    preferences: ['旧一', '旧二', '旧三', '旧四', '旧五', '旧六'],
  }, {
    text: '我喜欢猫',
    analysis: { topics: [], sentiment: 'neutral', intent: 'chat', ruleSignals: [] },
  });

  const preferences = update[0].$set.preferences.$literal;
  assert.equal(preferences[0], '猫');
  assert.equal(preferences.length, 6);
});

test('updateRelationProfile enables updatePipeline when using aggregation updates', async () => {
  const originalFindOneAndUpdate = Relation.findOneAndUpdate;
  const relation = {
    _id: 'rel-1',
    platform: 'qq',
    chatType: 'group',
    chatId: 'group-1',
    groupId: 'group-1',
    userId: 'user-1',
    preferences: [],
    favoriteTopics: [],
    tags: [],
  };

  try {
    let receivedOptions = null;
    Relation.findOneAndUpdate = async (_filter, update, options) => {
      receivedOptions = options;
      assert.equal(Array.isArray(update), true);
      return {
        toObject() {
          return {
            ...relation,
            affection: 31,
            activeScore: 25,
            interactionCount: 1,
            memorySummary: '偏好:猫；活跃度 25',
          };
        },
      };
    };

    await updateRelationProfile(relation, {
      text: '我喜欢猫',
      analysis: {
        topics: ['pets'],
        sentiment: 'positive',
        intent: 'chat',
        ruleSignals: [],
      },
    });

    assert.equal(receivedOptions?.updatePipeline, true);
    assert.equal(receivedOptions?.returnDocument, 'after');
  } finally {
    Relation.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
