import { runYunoConversation } from '../src/yuno-core.js';

function percentile(samples, p) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function createDeps(latencyMs) {
  return {
    ensureRelation: async () => ({
      _id: 'rel-1',
      platform: 'qq',
      chatType: 'private',
      chatId: 'user-1',
      groupId: 'qq:private:user-1',
      userId: 'user-1',
      affection: 60,
      preferences: [],
      favoriteTopics: [],
      tags: [],
      memorySummary: '',
      activeScore: 20,
    }),
    ensureUserState: async () => ({
      _id: 'state-1',
      platform: 'qq',
      chatType: 'private',
      chatId: 'user-1',
      groupId: 'qq:private:user-1',
      userId: 'user-1',
      currentEmotion: 'CALM',
      intensity: 0.3,
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
    getConversationState: async () => ({ rollingSummary: '', messages: [] }),
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
    chat: async (_messages, _systemPrompt, userTurn) => {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      return `bench:${userTurn || 'ok'}`;
    },
  };
}

function makeInput(scene, text) {
  if (scene === 'group') {
    return {
      platform: 'qq',
      chatType: 'group',
      chatId: 'group-1',
      userId: 'user-1',
      userName: 'BenchUser',
      messageId: `${Date.now()}`,
      text,
      rawText: text,
      mentionsBot: true,
      attachments: [],
      source: { adapter: 'benchmark', postType: 'message', messageType: 'group' },
    };
  }

  return {
    platform: 'qq',
    scene: 'private',
    userId: 'user-1',
    username: 'BenchUser',
    rawMessage: text,
    metadata: {
      messageId: `${Date.now()}`,
      timestamp: Date.now(),
    },
  };
}

async function runScenario(name, scene, text, modelLatencyMs, iterations = 10) {
  const samples = [];
  const deps = createDeps(modelLatencyMs);

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = Date.now();
    await runYunoConversation(makeInput(scene, text), {
      responseMode: 'capture',
      deps,
      replyTimeBudgetMs: 3500,
    });
    samples.push(Date.now() - startedAt);
  }

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  console.log(`${name}: p50=${p50}ms p95=${p95}ms samples=${samples.join(',')}`);
  return { name, p50, p95 };
}

async function main() {
  const scenarios = [
    ['group_mention', 'group', '@bot 今晚聊什么', 220],
    ['private_chat', 'private', '今天有点累，想聊聊', 260],
    ['knowledge_qa', 'private', '你的设定和规则大概是什么', 320],
  ];

  const results = [];
  for (const [name, scene, text, latency] of scenarios) {
    results.push(await runScenario(name, scene, text, latency, 10));
  }

  console.log('\nAcceptance targets:');
  console.log('- group_mention p95 <= 4000ms');
  console.log('- private_chat p95 <= 4500ms');
  console.log('- command_tool <= 1000ms (covered by smoke/test command path)');

  const failed = results.some((item) => (
    (item.name === 'group_mention' && item.p95 > 4000)
    || (item.name === 'private_chat' && item.p95 > 4500)
  ));
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`benchmark failed: ${error.message}`);
  process.exit(1);
});
