import test from 'node:test';
import assert from 'node:assert/strict';
import { Relation } from './src/models.js';
import { updateRelationProfile } from './src/session-state.js';

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
