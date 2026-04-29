import test from 'node:test';
import assert from 'node:assert/strict';
import { processIncomingMessage } from './src/message-workflow.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    userName: 'Alice',
    rawText: 'what can you do?',
    text: 'what can you do?',
    attachments: [],
    mentionsBot: false,
    timestamp: Date.now(),
    source: { adapter: 'test' },
    ...overrides,
  };
}

function createPrecomputedContext(event, overrides = {}) {
  return {
    relation: { _id: 'r1', affection: 40, activeScore: 20, preferences: [], favoriteTopics: [], userId: event.userId, platform: 'qq', chatType: event.chatType, chatId: event.chatId },
    userState: { _id: 'u1', currentEmotion: 'CALM', intensity: 0.4, triggerReason: 'baseline', userId: event.userId, platform: 'qq', chatType: event.chatType, chatId: event.chatId },
    userProfile: { _id: 'p1', profileSummary: '', favoriteTopics: [], dislikes: [], preferredName: '', tonePreference: '' },
    conversationState: { rollingSummary: 'previous chat summary', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'here' }] },
    groupState: event.chatType === 'group' ? { mood: 'CALM', activityLevel: 18, recentTopics: [] } : null,
    recentEvents: [],
    isAdmin: false,
    isAdvanced: false,
    event,
    analysis: {
      shouldRespond: true,
      confidence: 0.9,
      intent: 'query',
      sentiment: 'neutral',
      relevance: 0.9,
      reason: event.chatType === 'group' ? 'basic-direct-mention-pass' : 'private-default-reply',
      topics: ['settings'],
      ruleSignals: [event.chatType === 'group' ? 'direct-mention' : 'private-chat'],
      replyStyle: 'calm',
    },
    ...overrides,
  };
}

function createWorkflowDeps(overrides = {}) {
  return {
    sendReply: async () => {},
    sendVoice: async () => false,
    retrieveKnowledge: async () => ({ enabled: false, documents: [] }),
    chat: async (_messages, _systemPrompt, userTurn) => JSON.stringify({
      text: `reply:${userTurn}`,
      sendVoice: false,
      voiceText: '',
    }),
    appendConversationMessages: async (_session, messages) => ({ rollingSummary: 'summary', messages }),
    updateRelationProfile: async () => null,
    updateUserState: async () => null,
    updateUserProfileMemory: async () => null,
    shouldSendVoiceForEmotion: () => false,
    resolveVoiceRuntimeConfig: () => ({ enableVoice: true, voiceName: 'mimo_voice' }),
    ...overrides,
  };
}

test('processIncomingMessage runs the unified workflow and persists memory with mocks', async () => {
  const sentReplies = [];
  const persistedMessages = [];
  const knowledgeQueries = [];
  const event = createEvent({
    rawText: 'what is your setting?',
    text: 'what is your setting?',
  });

  const reply = await processIncomingMessage(event, createPrecomputedContext(event), {
    deps: createWorkflowDeps({
      sendReply: async (_target, text) => {
        sentReplies.push(text);
      },
      planIncomingTask: () => ({
        type: 'chat',
        category: 'knowledge_qa',
        requiresModel: true,
        requiresRetrieval: true,
        allowFollowUp: true,
        reason: 'test-knowledge-route',
      }),
      retrieveKnowledge: async (query) => {
        knowledgeQueries.push(query);
        return {
          enabled: true,
          documents: [{ text: 'Yuno keeps a natural but restrained style.', metadata: { title: 'persona', source: 'knowledge/persona/core.md' } }],
        };
      },
      chat: async (_messages, _systemPrompt, userTurn) => `reply:${userTurn}`,
      appendConversationMessages: async (_session, messages) => {
        persistedMessages.push(...messages);
        return { rollingSummary: 'summary', messages };
      },
    }),
  });

  assert.equal(reply, 'reply:what is your setting?');
  assert.equal(sentReplies[0], 'reply:what is your setting?');
  assert.equal(knowledgeQueries[0], 'what is your setting?');
  assert.equal(persistedMessages.length, 2);
  assert.equal(persistedMessages[0].role, 'user');
  assert.equal(persistedMessages[1].role, 'assistant');
});

test('processIncomingMessage sends text and voice in private chat when model requests voice', async () => {
  const event = createEvent({
    rawText: 'say something nice',
    text: 'say something nice',
  });
  const sentReplies = [];
  const sentVoices = [];
  const ttsInputs = [];

  const reply = await processIncomingMessage(event, createPrecomputedContext(event), {
    deps: createWorkflowDeps({
      sendReply: async (_target, text) => sentReplies.push(text),
      sendVoice: async (_target, audio) => {
        sentVoices.push(audio.toString());
        return true;
      },
      tts: async (text) => {
        ttsInputs.push(text);
        return Buffer.from(`audio:${text}`);
      },
      chat: async (_messages, _systemPrompt, userTurn) => JSON.stringify({
        text: `reply:${userTurn}`,
        sendVoice: true,
        voiceText: 'voice only line',
      }),
    }),
  });

  assert.equal(reply, 'reply:say something nice');
  assert.equal(sentReplies[0], 'reply:say something nice');
  assert.deepEqual(ttsInputs, ['voice only line']);
  assert.deepEqual(sentVoices, ['audio:voice only line']);
});

test('processIncomingMessage suppresses voice in group chat when bot is not mentioned', async () => {
  const event = createEvent({
    chatType: 'group',
    chatId: '20001',
    rawText: 'passing by',
    text: 'passing by',
    mentionsBot: false,
  });
  const sentReplies = [];
  const sentVoices = [];
  const ttsInputs = [];

  await processIncomingMessage(event, createPrecomputedContext(event), {
    deps: createWorkflowDeps({
      sendReply: async (_target, text) => sentReplies.push(text),
      sendVoice: async (_target, audio) => {
        sentVoices.push(audio);
        return true;
      },
      tts: async (text) => {
        ttsInputs.push(text);
        return Buffer.from(`audio:${text}`);
      },
      chat: async (_messages, _systemPrompt, userTurn) => JSON.stringify({
        text: `reply:${userTurn}`,
        sendVoice: true,
      }),
    }),
  });

  assert.equal(sentReplies.length, 1);
  assert.equal(ttsInputs.length, 0);
  assert.equal(sentVoices.length, 0);
});

test('processIncomingMessage sends voice in group chat when bot is mentioned', async () => {
  const event = createEvent({
    chatType: 'group',
    chatId: '20002',
    rawText: '[CQ:at,qq=bot] say one line',
    text: 'say one line',
    mentionsBot: true,
  });
  const sentVoices = [];

  await processIncomingMessage(event, createPrecomputedContext(event), {
    deps: createWorkflowDeps({
      sendVoice: async (_target, audio) => {
        sentVoices.push(audio.toString());
        return true;
      },
      tts: async (text) => Buffer.from(`audio:${text}`),
      chat: async (_messages, _systemPrompt, userTurn) => JSON.stringify({
        text: `reply:${userTurn}`,
        sendVoice: true,
      }),
    }),
  });

  assert.equal(sentVoices.length, 1);
  assert.equal(sentVoices[0], 'audio:reply:say one line');
});

test('processIncomingMessage falls back to plain text when model reply is not structured json', async () => {
  const event = createEvent({
    rawText: 'just answer normally',
    text: 'just answer normally',
  });
  const sentReplies = [];
  const sentVoices = [];

  const reply = await processIncomingMessage(event, createPrecomputedContext(event), {
    deps: createWorkflowDeps({
      sendReply: async (_target, text) => sentReplies.push(text),
      sendVoice: async (_target, audio) => {
        sentVoices.push(audio);
        return true;
      },
      tts: async (text) => Buffer.from(`audio:${text}`),
      chat: async () => 'plain text fallback',
    }),
  });

  assert.equal(reply, 'plain text fallback');
  assert.equal(sentReplies[0], 'plain text fallback');
  assert.equal(sentVoices.length, 0);
});
