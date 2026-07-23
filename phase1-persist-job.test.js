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

test('processPersistJob does not fail post-reply updates when memory vector indexing returns 400', async () => {
  const calls = [];
  const warnings = [];
  const indexingError = new Error('Request failed with status code 400');
  indexingError.response = { status: 400 };

  const result = await processPersistJob({
    event: {
      platform: 'qq',
      chatType: 'private',
      chatId: '2945932142',
      userId: '2945932142',
      userName: 'Tester',
      text: '记住我下周有面试',
      rawText: '记住我下周有面试',
      messageId: '2031350560',
    },
    analysis: {
      reason: 'private-default-reply',
      sentiment: 'neutral',
      intent: 'help',
      relevance: 0.9,
      confidence: 0.9,
      ruleSignals: [],
    },
    emotionResult: { emotion: 'CALM', intensity: 0.4 },
    summary: 'Tester: 记住我下周有面试',
    username: 'Tester',
    rawText: '记住我下周有面试',
    userTurn: '记住我下周有面试',
    nextMessages: [
      { role: 'user', content: '记住我下周有面试' },
      { role: 'assistant', content: '我记住了。' },
    ],
    contextSnapshot: {
      session: { platform: 'qq', chatType: 'private', chatId: '2945932142', userId: '2945932142' },
      isAdvanced: false,
      specialUser: null,
      contextMode: 'snapshot',
      relation: null,
      userState: null,
      userProfile: null,
    },
  }, {
    deps: {
      appendConversationMessages: async () => {
        calls.push('history');
      },
      persistUserMemoryEvents: async () => {
        calls.push('memory-persisted');
        return [{ memoryId: 'mem-1', embeddingSourceText: 'type:milestone | 面试' }];
      },
      indexUserMemoryEvents: async () => {
        calls.push('memory-index-attempted');
        throw indexingError;
      },
      logger: {
        warn: (category, message, fields) => warnings.push({ category, message, fields }),
        info: () => {},
      },
    },
  });

  assert.equal(result, true);
  assert.deepEqual(calls, ['history', 'memory-persisted', 'memory-index-attempted']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'User memory vector indexing failed after persistence');
  assert.equal(warnings[0].fields.status, 400);
});

test('processPersistJob treats memory extraction provider 400 as a skipped optional update', async () => {
  const calls = [];
  const warnings = [];
  const extractionError = new Error('Request failed with status code 400');
  extractionError.response = { status: 400 };

  const result = await processPersistJob({
    event: {
      platform: 'qq',
      chatType: 'private',
      chatId: '2945932142',
      userId: '2945932142',
      userName: 'Tester',
      text: '记住我下周有面试',
      rawText: '记住我下周有面试',
      messageId: '2031350560',
    },
    analysis: {
      reason: 'private-default-reply',
      sentiment: 'neutral',
      intent: 'help',
      relevance: 0.9,
      confidence: 0.9,
      ruleSignals: [],
    },
    emotionResult: { emotion: 'CALM', intensity: 0.4 },
    summary: 'Tester: 记住我下周有面试',
    username: 'Tester',
    rawText: '记住我下周有面试',
    userTurn: '记住我下周有面试',
    nextMessages: [
      { role: 'user', content: '记住我下周有面试' },
      { role: 'assistant', content: '我记住了。' },
    ],
    contextSnapshot: {
      session: { platform: 'qq', chatType: 'private', chatId: '2945932142', userId: '2945932142' },
      isAdvanced: false,
      specialUser: null,
      contextMode: 'snapshot',
      relation: null,
      userState: null,
      userProfile: null,
    },
  }, {
    deps: {
      appendConversationMessages: async () => {
        calls.push('history');
      },
      persistUserMemoryEvents: async () => {
        calls.push('memory-extraction-attempted');
        throw extractionError;
      },
      indexUserMemoryEvents: async () => {
        calls.push('memory-index-unexpected');
      },
      logger: {
        warn: (category, message, fields) => warnings.push({ category, message, fields }),
        info: () => {},
      },
    },
  });

  assert.equal(result, true);
  assert.deepEqual(calls, ['history', 'memory-extraction-attempted']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'User memory extraction skipped after provider error');
  assert.equal(warnings[0].fields.status, 400);
});

test('processPersistJob also skips memory extraction 400 when status only appears in error message', async () => {
  const warnings = [];
  const extractionError = new Error('Request failed with status code 400');

  const result = await processPersistJob({
    event: {
      platform: 'qq',
      chatType: 'private',
      chatId: '2945932142',
      userId: '2945932142',
      userName: 'Tester',
      text: '记住我下周有面试',
      rawText: '记住我下周有面试',
      messageId: '2031350560',
    },
    analysis: {
      reason: 'private-default-reply',
      sentiment: 'neutral',
      intent: 'help',
      relevance: 0.9,
      confidence: 0.9,
      ruleSignals: [],
    },
    emotionResult: { emotion: 'CALM', intensity: 0.4 },
    summary: 'Tester: 记住我下周有面试',
    username: 'Tester',
    rawText: '记住我下周有面试',
    userTurn: '记住我下周有面试',
    nextMessages: [
      { role: 'user', content: '记住我下周有面试' },
      { role: 'assistant', content: '我记住了。' },
    ],
    contextSnapshot: {
      session: { platform: 'qq', chatType: 'private', chatId: '2945932142', userId: '2945932142' },
      isAdvanced: false,
      specialUser: null,
      contextMode: 'snapshot',
      relation: null,
      userState: null,
      userProfile: null,
    },
  }, {
    deps: {
      appendConversationMessages: async () => null,
      persistUserMemoryEvents: async () => {
        throw extractionError;
      },
      logger: {
        warn: (category, message, fields) => warnings.push({ category, message, fields }),
        info: () => {},
      },
    },
  });

  assert.equal(result, true);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'User memory extraction skipped after provider error');
  assert.equal(warnings[0].fields.status, 400);
});

test('processPersistJob optional mode skips critical conversation history writes', async () => {
  let appendCalls = 0;
  let relationUpdates = 0;
  const result = await processPersistJob({
    taskMode: 'optional',
    event: {
      platform: 'qq', chatType: 'private', chatId: 'user-1', userId: 'user-1',
      userName: 'Tester', text: 'hello', rawText: 'hello', messageId: 'msg-optional',
    },
    analysis: { reason: 'private-default-reply', sentiment: 'neutral', intent: 'chat', ruleSignals: [] },
    emotionResult: { emotion: 'CALM', intensity: 0.2 },
    summary: 'Tester: hello',
    username: 'Tester',
    rawText: 'hello',
    userTurn: 'hello',
    nextMessages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ],
    contextSnapshot: {
      session: { platform: 'qq', chatType: 'private', chatId: 'user-1', userId: 'user-1' },
      isAdvanced: false,
      relation: {
        _id: 'rel-1', platform: 'qq', chatType: 'private', chatId: 'user-1',
        groupId: 'user-1', userId: 'user-1', affection: 40, preferences: [], favoriteTopics: [], tags: [],
      },
      userState: null,
      userProfile: null,
      memoryContext: { eventMemories: [], memeMemories: [] },
    },
  }, {
    deps: {
      appendConversationMessages: async () => { appendCalls += 1; },
      updateRelationProfile: async () => { relationUpdates += 1; },
      persistUserMemoryEvents: async () => [],
      indexUserMemoryEvents: async () => null,
      updateUserState: async () => null,
      updateUserProfileMemory: async () => null,
      updateGroupStateFromAnalysis: async () => null,
    },
  });

  assert.equal(result, true);
  assert.equal(appendCalls, 0);
  assert.equal(relationUpdates, 1);
});
