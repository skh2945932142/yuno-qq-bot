import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRespondToEvent } from './src/message-workflow.js';

function createPrivateEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    userName: 'Alice',
    messageId: 'm-1',
    rawText: '今天面试被问崩了，好烦',
    text: '今天面试被问崩了，好烦',
    attachments: [],
    mentionsBot: false,
    timestamp: Date.now(),
    source: { adapter: 'test', postType: 'message' },
    ...overrides,
  };
}

function createContextDeps(extra = {}) {
  return {
    ensureRelation: async () => ({ _id: 'r1', affection: 55, preferences: [], favoriteTopics: [] }),
    ensureUserState: async () => ({ _id: 's1', currentEmotion: 'CALM' }),
    ensureUserProfileMemory: async () => ({ _id: 'p1', userId: '10001' }),
    getConversationState: async () => ({ rollingSummary: '', messages: [] }),
    ensureGroupState: async () => null,
    getRecentEvents: async () => [],
    retrieveMemoryContext: async () => ({ eventMemories: [], memeMemories: [] }),
    ...extra,
  };
}

test('private chat sharpens sentiment and intent with the semantic classifier', async () => {
  let analyzeCalls = 0;
  const decision = await shouldRespondToEvent(createPrivateEvent(), {
    finalizeTrace: false,
    deps: createContextDeps({
      analyzeMessage: async (text) => {
        analyzeCalls += 1;
        assert.equal(text, '今天面试被问崩了，好烦');
        return {
          intent: 'help',
          sentiment: 'negative',
          topics: ['面试'],
          confidence: 0.9,
          replyStyle: 'sharp',
        };
      },
    }),
  });

  assert.equal(analyzeCalls, 1);
  // Private chat is still answered unconditionally; only the semantics change.
  assert.equal(decision.analysis.shouldRespond, true);
  assert.equal(decision.analysis.intent, 'help');
  assert.equal(decision.analysis.sentiment, 'negative');
  assert.deepEqual(decision.analysis.topics, ['面试']);
  assert.equal(decision.analysis.semanticSource, 'llm');
});

test('private chat returns the loaded context so it is not fetched twice', async () => {
  let relationLoads = 0;
  const decision = await shouldRespondToEvent(createPrivateEvent(), {
    finalizeTrace: false,
    deps: createContextDeps({
      ensureRelation: async () => {
        relationLoads += 1;
        return { _id: 'r1', affection: 55, preferences: [], favoriteTopics: [] };
      },
      analyzeMessage: async () => ({ intent: 'chat', sentiment: 'neutral' }),
    }),
  });

  assert.equal(relationLoads, 1);
  // processIncomingMessage reuses a decision that already carries these three.
  assert.ok(decision.relation);
  assert.ok(decision.userState);
  assert.ok(decision.conversationState);
});

test('private semantic analysis falls back to rule signals on timeout', async () => {
  const decision = await shouldRespondToEvent(createPrivateEvent(), {
    finalizeTrace: false,
    runtimeConfig: { privateSemanticTimeoutMs: 500 },
    deps: createContextDeps({
      analyzeMessage: () => new Promise((resolve) => {
        setTimeout(() => resolve({ intent: 'help', sentiment: 'negative' }), 5000);
      }),
    }),
  });

  assert.equal(decision.analysis.shouldRespond, true);
  assert.equal(decision.analysis.semanticSource, undefined);
  // The repaired rule tables still classify this correctly on their own.
  assert.equal(decision.analysis.sentiment, 'negative');
});

test('private semantic analysis survives a classifier error', async () => {
  const decision = await shouldRespondToEvent(createPrivateEvent(), {
    finalizeTrace: false,
    deps: createContextDeps({
      analyzeMessage: async () => { throw new Error('provider exploded'); },
      logger: { info() {}, warn() {}, error() {} },
    }),
  });

  assert.equal(decision.analysis.shouldRespond, true);
  assert.equal(decision.analysis.semanticSource, undefined);
});

test('private semantic analysis can be disabled by config', async () => {
  let analyzeCalls = 0;
  const decision = await shouldRespondToEvent(createPrivateEvent(), {
    finalizeTrace: false,
    runtimeConfig: { privateSemanticAnalysisEnabled: false },
    deps: createContextDeps({
      analyzeMessage: async () => { analyzeCalls += 1; return { intent: 'help' }; },
    }),
  });

  assert.equal(analyzeCalls, 0);
  assert.equal(decision.analysis.shouldRespond, true);
});

test('private commands skip the classifier entirely', async () => {
  let analyzeCalls = 0;
  const decision = await shouldRespondToEvent(createPrivateEvent({
    rawText: '/help',
    text: '/help',
  }), {
    finalizeTrace: false,
    deps: createContextDeps({
      analyzeMessage: async () => { analyzeCalls += 1; return { intent: 'help' }; },
    }),
  });

  assert.equal(analyzeCalls, 0);
  assert.equal(decision.analysis.shouldRespond, true);
});

test('group chat never triggers the private semantic pass', async () => {
  let analyzeCalls = 0;
  const decision = await shouldRespondToEvent(createPrivateEvent({
    chatType: 'group',
    chatId: '20001',
    mentionsBot: true,
    rawText: '[CQ:at,qq=999] 帮我看看',
    text: '帮我看看',
    selfId: '999',
  }), {
    finalizeTrace: false,
    deps: createContextDeps({
      analyzeMessage: async () => { analyzeCalls += 1; return { intent: 'help' }; },
    }),
  });

  assert.equal(analyzeCalls, 0);
  assert.equal(decision.analysis.shouldRespond, true);
  // The group fast path returns without loading context, as before.
  assert.equal(decision.relation, undefined);
});
