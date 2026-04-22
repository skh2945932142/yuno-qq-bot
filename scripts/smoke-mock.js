import { runYunoConversation } from '../src/yuno-core.js';

function createDeps() {
  return {
    ensureRelation: async () => ({
      _id: 'rel-1',
      platform: 'qq',
      chatType: 'private',
      chatId: 'user-1',
      groupId: 'qq:private:user-1',
      userId: 'user-1',
      affection: 65,
      preferences: [],
      favoriteTopics: ['daily'],
      tags: [],
      memorySummary: '',
      activeScore: 30,
    }),
    ensureUserState: async () => ({
      _id: 'state-1',
      platform: 'qq',
      chatType: 'private',
      chatId: 'user-1',
      groupId: 'qq:private:user-1',
      userId: 'user-1',
      currentEmotion: 'CALM',
      intensity: 0.35,
      triggerReason: 'baseline',
    }),
    ensureUserProfileMemory: async () => ({
      _id: 'profile-1',
      platform: 'qq',
      userId: 'user-1',
      profileKey: 'qq:user-1',
      profileSummary: '',
      favoriteTopics: [],
      dislikes: [],
      preferredName: '',
      tonePreference: '',
      bondMemories: [],
      specialNicknames: [],
    }),
    getConversationState: async () => ({
      rollingSummary: '',
      messages: [],
    }),
    ensureGroupState: async () => null,
    getRecentEvents: async () => [],
    updateRelationProfile: async () => null,
    updateUserState: async () => null,
    appendConversationMessages: async () => null,
    updateUserProfileMemory: async () => null,
    updateGroupStateFromAnalysis: async () => null,
    retrieveKnowledge: async () => ({ enabled: false, source: 'none', reason: 'mock', documents: [] }),
    sendReply: async () => true,
    sendStructuredReply: async () => true,
    sendVoice: async () => true,
    enqueuePersistJob: null,
    shouldSendVoiceForEmotion: () => false,
    chat: async (_messages, _systemPrompt, userTurn) => `mock:${userTurn || 'ok'}`,
  };
}

function assertScenario(name, condition, details) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    return;
  }

  console.error(`[FAIL] ${name}: ${details}`);
  process.exitCode = 1;
}

async function run() {
  const deps = createDeps();

  const privateResult = await runYunoConversation({
    platform: 'qq',
    scene: 'private',
    userId: 'user-1',
    username: 'MockUser',
    rawMessage: '今天有点累',
    metadata: {
      messageId: 'm-private-1',
      timestamp: Date.now(),
    },
  }, {
    responseMode: 'capture',
    deps,
  });

  assertScenario(
    'private conversation route',
    !privateResult.suppressed && privateResult.response?.text?.startsWith('mock:'),
    `unexpected private result: ${JSON.stringify(privateResult.analysis || {})}`
  );

  const commandResult = await runYunoConversation({
    platform: 'qq',
    chatType: 'group',
    chatId: 'g-1',
    userId: 'user-1',
    userName: 'MockUser',
    rawText: '/help',
    text: '/help',
    messageId: 'm-group-1',
    mentionsBot: false,
    attachments: [],
    source: { postType: 'message', messageType: 'group', adapter: 'mock' },
  }, {
    responseMode: 'capture',
    deps,
  });

  assertScenario(
    'command tool route',
    !commandResult.suppressed
      && commandResult.response?.outputs?.some((item) => item.type === 'text'),
    `unexpected command result: ${JSON.stringify(commandResult.analysis || {})}`
  );

  if (process.exitCode) {
    process.exit(process.exitCode);
  }

  console.log('Mock smoke passed.');
}

run().catch((error) => {
  console.error(`Mock smoke failed: ${error.message}`);
  process.exit(1);
});
