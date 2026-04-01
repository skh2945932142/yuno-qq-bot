import test from 'node:test';
import assert from 'node:assert/strict';
import { processPersistJob } from './src/message-workflow.js';

test('processPersistJob reuses context snapshot without reloading workflow context', async () => {
  const calls = [];
  const failIfCalled = async () => {
    throw new Error('context reload should not happen');
  };

  const result = await processPersistJob({
    event: {
      platform: 'qq',
      chatType: 'private',
      chatId: 'user-1',
      userId: 'user-1',
      userName: 'Tester',
      text: '??',
      rawText: '??',
      messageId: 'msg-1',
    },
    analysis: { reason: 'private-default-reply', sentiment: 'positive', intent: 'chat', ruleSignals: [] },
    emotionResult: { emotion: 'AFFECTIONATE', intensity: 0.6 },
    summary: 'Tester: ??',
    username: 'Tester',
    rawText: '??',
    userTurn: '??',
    nextMessages: [
      { role: 'user', content: '??' },
      { role: 'assistant', content: '???' },
    ],
    contextSnapshot: {
      session: { platform: 'qq', chatType: 'private', chatId: 'user-1', userId: 'user-1' },
      isAdvanced: false,
      specialUser: null,
      contextMode: 'snapshot',
      relation: {
        _id: 'rel-1',
        platform: 'qq',
        chatType: 'private',
        chatId: 'user-1',
        groupId: 'user-1',
        userId: 'user-1',
        affection: 88,
        preferences: [],
        favoriteTopics: [],
        tags: [],
        memorySummary: '',
        activeScore: 20,
      },
      userState: {
        _id: 'state-1',
        platform: 'qq',
        chatType: 'private',
        chatId: 'user-1',
        groupId: 'user-1',
        userId: 'user-1',
        currentEmotion: 'CALM',
        intensity: 0.3,
        triggerReason: 'baseline',
      },
      userProfile: {
        _id: 'profile-1',
        platform: 'qq',
        userId: 'user-1',
        profileKey: 'qq:user-1',
        displayName: 'Tester',
        preferredName: '',
        tonePreference: '',
        favoriteTopics: [],
        dislikes: [],
        roleplaySettings: [],
        relationshipPreference: '',
        personaMode: '',
        specialBondSummary: '',
        bondMemories: [],
        specialNicknames: [],
        profileSummary: '',
      },
    },
  }, {
    deps: {
      ensureRelation: failIfCalled,
      ensureUserState: failIfCalled,
      ensureUserProfileMemory: failIfCalled,
      getConversationState: failIfCalled,
      ensureGroupState: failIfCalled,
      getRecentEvents: failIfCalled,
      appendConversationMessages: async (session, nextMessages) => {
        calls.push(['history', session, nextMessages.length]);
      },
      updateRelationProfile: async (relation) => {
        calls.push(['relation', relation._id]);
      },
      updateUserState: async (userState) => {
        calls.push(['user-state', userState._id]);
      },
      updateUserProfileMemory: async (profile) => {
        calls.push(['profile', profile._id]);
      },
      updateGroupStateFromAnalysis: async () => {
        calls.push(['group']);
      },
    },
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    ['history', { platform: 'qq', chatType: 'private', chatId: 'user-1', userId: 'user-1' }, 2],
    ['relation', 'rel-1'],
    ['user-state', 'state-1'],
    ['profile', 'profile-1'],
  ]);
});
