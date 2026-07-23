import test from 'node:test';
import assert from 'node:assert/strict';
import { Relation, UserState } from './src/models.js';
import {
  ensureRelation,
  ensureUserState,
  updateRelationProfile,
  updateUserState,
} from './src/session-state.js';

const session = { platform: 'qq', chatType: 'group', chatId: 'g1', userId: 'u1' };

test('session state returns matching documents and migrates stale session fields', async () => {
  const originalFind = Relation.findOne;
  const originalUpdate = Relation.findOneAndUpdate;
  try {
    Relation.findOne = async () => ({
      _id: 'r1', sessionKey: 'qq:group:g1:u1', platform: 'qq', chatType: 'group', chatId: 'g1', affection: 40,
    });
    assert.equal((await ensureRelation(session))._id, 'r1');

    let findCalls = 0;
    Relation.findOne = async () => {
      findCalls += 1;
      return findCalls === 1
        ? { _id: 'legacy', sessionKey: 'old', platform: 'qq', chatType: 'group', chatId: 'old', affection: 40 }
        : null;
    };
    Relation.findOneAndUpdate = async (_filter, update) => ({ _id: 'legacy', ...update.$set, affection: 40 });
    const migrated = await ensureRelation(session);
    assert.equal(migrated.sessionKey, 'qq:group:g1:u1');
    assert.equal(migrated.chatId, 'g1');
  } finally {
    Relation.findOne = originalFind;
    Relation.findOneAndUpdate = originalUpdate;
  }
});

test('session state creates missing relation and user state records', async () => {
  const originalRelationFind = Relation.findOne;
  const originalRelationUpdate = Relation.findOneAndUpdate;
  const originalStateFind = UserState.findOne;
  const originalStateUpdate = UserState.findOneAndUpdate;
  try {
    Relation.findOne = async () => null;
    Relation.findOneAndUpdate = async (_filter, update) => ({ _id: 'created-relation', ...update.$setOnInsert });
    const relation = await ensureRelation(session);
    assert.equal(relation._id, 'created-relation');
    assert.equal(relation.affection, 30);

    UserState.findOne = async () => null;
    UserState.findOneAndUpdate = async (_filter, update) => ({ _id: 'created-state', ...update.$setOnInsert });
    const state = await ensureUserState(session);
    assert.equal(state._id, 'created-state');
    assert.equal(state.sessionKey, 'qq:group:g1:u1');
  } finally {
    Relation.findOne = originalRelationFind;
    Relation.findOneAndUpdate = originalRelationUpdate;
    UserState.findOne = originalStateFind;
    UserState.findOneAndUpdate = originalStateUpdate;
  }
});

test('session state update helpers apply model results back to mutable records', async () => {
  const originalRelationUpdate = Relation.findOneAndUpdate;
  const originalStateUpdate = UserState.findOneAndUpdate;
  const relation = {
    _id: 'r1', platform: 'qq', chatType: 'private', chatId: 'u1', groupId: 'qq:private:u1', userId: 'u1',
    affection: 40, preferences: [], favoriteTopics: ['old'], tags: [], activeScore: 10,
  };
  const userState = {
    _id: 's1', platform: 'qq', chatType: 'private', chatId: 'u1', groupId: 'qq:private:u1', userId: 'u1',
  };
  try {
    Relation.findOneAndUpdate = async (_filter, pipeline, options) => {
      assert.equal(options.updatePipeline, true);
      assert.equal(pipeline[0].$set.lastSentiment, 'positive');
      return { toObject: () => ({ ...relation, affection: 43, activeScore: 31 }) };
    };
    UserState.findOneAndUpdate = async (_filter, update) => ({
      toObject: () => ({ ...userState, ...update.$set }),
    });

    const updatedRelation = await updateRelationProfile(relation, {
      text: '我喜欢咖啡',
      analysis: { sentiment: 'positive', intent: 'help', topics: ['coffee'], ruleSignals: [] },
    });
    assert.equal(updatedRelation.toObject().affection, 43);
    assert.equal(relation.activeScore, 31);

    const updatedState = await updateUserState(userState, {
      emotion: 'CURIOUS', intensity: 0.7, reason: 'question',
    }, { intent: 'query', sentiment: 'neutral' });
    assert.equal(updatedState.toObject().currentEmotion, 'CURIOUS');
    assert.equal(userState.lastIntent, 'query');
  } finally {
    Relation.findOneAndUpdate = originalRelationUpdate;
    UserState.findOneAndUpdate = originalStateUpdate;
  }
});
