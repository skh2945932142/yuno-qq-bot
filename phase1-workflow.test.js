import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeVoiceTtsText,
  processIncomingMessage,
  resolveVoiceReplyDecision,
} from './src/message-workflow.js';

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
    resolveVoiceRuntimeConfig: () => ({
      enableVoice: true,
      voiceName: 'mimo_voice',
      mode: 'auto',
      cooldownMs: 0,
      maxChars: 90,
      onUserRecord: true,
    }),
    ...overrides,
  };
}

test('resolveVoiceReplyDecision allows short private voice suggested by model', () => {
  const event = createEvent({ chatType: 'private', text: '哄哄我' });

  const decision = resolveVoiceReplyDecision({
    event,
    route: { category: 'private_chat' },
    replyDecision: { sendVoice: true },
    replyText: '我在，先别一个人硬撑。',
    voiceText: '我在，先别一个人硬撑。',
    emotionResult: { emotion: 'AFFECTIONATE', intensity: 0.7 },
    nowMs: 1000,
    runtimeConfig: {
      mode: 'auto',
      enableVoice: true,
      voiceName: 'mimo_voice',
      maxChars: 80,
      cooldownMs: 60000,
      onUserRecord: true,
    },
  });

  assert.equal(decision.shouldSend, true);
  assert.equal(decision.reason, 'model-suggested');
});

test('resolveVoiceReplyDecision rejects long knowledge replies even when model suggests voice', () => {
  const event = createEvent({ chatType: 'private', text: '讲一下设定' });

  const decision = resolveVoiceReplyDecision({
    event,
    route: { category: 'knowledge_qa' },
    replyDecision: { sendVoice: true },
    replyText: 'a'.repeat(120),
    voiceText: 'a'.repeat(120),
    emotionResult: { emotion: 'CALM', intensity: 0.4 },
    nowMs: 1000,
    runtimeConfig: {
      mode: 'auto',
      enableVoice: true,
      voiceName: 'mimo_voice',
      maxChars: 80,
      cooldownMs: 60000,
      onUserRecord: true,
    },
  });

  assert.equal(decision.shouldSend, false);
  assert.equal(decision.reason, 'voice-text-too-long');
});

test('resolveVoiceReplyDecision can actively answer user voice with TTS', () => {
  const event = createEvent({
    chatType: 'private',
    text: '',
    rawText: '[CQ:record,file=voice.silk]',
    attachments: [{ type: 'record', data: { file: 'voice.silk' } }],
  });

  const decision = resolveVoiceReplyDecision({
    event,
    route: { category: 'private_chat' },
    replyDecision: { sendVoice: false },
    replyText: '听到了，我先陪你把这句接住。',
    voiceText: '听到了，我先陪你把这句接住。',
    emotionResult: { emotion: 'CALM', intensity: 0.4 },
    nowMs: 1000,
    runtimeConfig: {
      mode: 'auto',
      enableVoice: true,
      voiceName: 'mimo_voice',
      maxChars: 80,
      cooldownMs: 60000,
      onUserRecord: true,
    },
  });

  assert.equal(decision.shouldSend, true);
  assert.equal(decision.reason, 'user-sent-voice');
});

test('resolveVoiceReplyDecision applies per-chat cooldown', () => {
  const event = createEvent({ chatType: 'private', chatId: 'cooldown-chat' });
  const runtimeConfig = {
    mode: 'auto',
    enableVoice: true,
    voiceName: 'mimo_voice',
    maxChars: 80,
    cooldownMs: 60000,
    onUserRecord: true,
  };

  const first = resolveVoiceReplyDecision({
    event,
    route: { category: 'private_chat' },
    replyDecision: { sendVoice: true },
    replyText: '第一句短语音。',
    voiceText: '第一句短语音。',
    emotionResult: { emotion: 'AFFECTIONATE', intensity: 0.8 },
    nowMs: 1000,
    runtimeConfig,
    lastVoiceSentAtByChat: new Map([['private:cooldown-chat', 800]]),
  });

  const second = resolveVoiceReplyDecision({
    event,
    route: { category: 'private_chat' },
    replyDecision: { sendVoice: true },
    replyText: '第二句短语音。',
    voiceText: '第二句短语音。',
    emotionResult: { emotion: 'AFFECTIONATE', intensity: 0.8 },
    nowMs: 70000,
    runtimeConfig,
    lastVoiceSentAtByChat: new Map([['private:cooldown-chat', 800]]),
  });

  assert.equal(first.shouldSend, false);
  assert.equal(first.reason, 'voice-cooldown');
  assert.equal(second.shouldSend, true);
});

test('normalizeVoiceTtsText strips formatting and trims to a speakable line', () => {
  const result = normalizeVoiceTtsText('**别急**\n- [CQ:image,file=meme.png] 我在。\n```js\nnope\n```', {
    maxChars: 12,
  });

  assert.equal(result, '别急 我在。');
});

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

test('processIncomingMessage can send contextual meme as structured text plus image', async () => {
  const event = createEvent({
    chatType: 'group',
    chatId: 'meme-group',
    rawText: '[CQ:at,qq=bot] 笑死，太离谱了',
    text: '笑死，太离谱了',
    mentionsBot: true,
  });
  const structuredReplies = [];
  const textReplies = [];
  const usedMemes = [];
  const precomputed = createPrecomputedContext(event, {
    memoryContext: {
      eventMemories: [],
      memeMemories: [{
        assetId: 'meme-1',
        storagePath: 'memes/funny.png',
        safetyStatus: 'safe',
        semanticTags: ['funny'],
        usageContext: 'group-reaction',
      }],
    },
    analysis: {
      shouldRespond: true,
      confidence: 0.95,
      intent: 'chat',
      sentiment: 'positive',
      relevance: 0.9,
      reason: 'basic-direct-mention-pass',
      topics: ['meme'],
      ruleSignals: ['direct-mention'],
      replyStyle: 'playful',
    },
  });

  const reply = await processIncomingMessage(event, precomputed, {
    deps: createWorkflowDeps({
      sendReply: async (_target, text) => textReplies.push(text),
      sendStructuredReply: async (_target, outputs) => {
        structuredReplies.push(outputs);
        return true;
      },
      markMemeUsed: async (assetId) => usedMemes.push(assetId),
      planContextualMemeReply: () => ({
        shouldSend: true,
        suggested: true,
        reason: 'high-semantic-match',
        mode: 'auto',
        score: 0.9,
        asset: {
          assetId: 'meme-1',
          storagePath: 'memes/funny.png',
        },
        recordSent: () => {},
      }),
      chat: async (_messages, _systemPrompt, userTurn) => JSON.stringify({
        text: `reply:${userTurn}`,
        sendVoice: false,
      }),
    }),
  });

  assert.equal(reply, 'reply:笑死，太离谱了');
  assert.equal(textReplies.length, 0);
  assert.equal(structuredReplies.length, 1);
  assert.deepEqual(structuredReplies[0][0], { type: 'text', text: 'reply:笑死，太离谱了' });
  assert.deepEqual(structuredReplies[0][1], { type: 'image', image: { file: 'memes/funny.png' } });
  assert.deepEqual(usedMemes, ['meme-1']);
});

test('processIncomingMessage merges provider meme candidates into planner input', async () => {
  const event = createEvent({
    chatType: 'group',
    chatId: 'provider-group',
    rawText: '[CQ:at,qq=bot] 笑死，太离谱了',
    text: '笑死，太离谱了',
    mentionsBot: true,
  });
  const seenCandidateIds = [];
  const structuredReplies = [];
  const precomputed = createPrecomputedContext(event, {
    memoryContext: {
      eventMemories: [],
      memeMemories: [{
        assetId: 'semantic-memory',
        storagePath: 'memes/memory.png',
        safetyStatus: 'safe',
      }],
    },
    analysis: {
      shouldRespond: true,
      confidence: 0.95,
      intent: 'chat',
      sentiment: 'positive',
      relevance: 0.9,
      reason: 'basic-direct-mention-pass',
      topics: ['meme'],
      ruleSignals: ['direct-mention'],
      replyStyle: 'playful',
    },
  });

  await processIncomingMessage(event, precomputed, {
    deps: createWorkflowDeps({
      getMemeCandidates: async () => [{
        assetId: 'provider-global',
        storagePath: 'memes/global.png',
        safetyStatus: 'safe',
      }],
      sendStructuredReply: async (_target, outputs) => {
        structuredReplies.push(outputs);
        return true;
      },
      markMemeUsed: async () => null,
      planContextualMemeReply: ({ memeCandidates }) => {
        seenCandidateIds.push(...memeCandidates.map((item) => item.assetId));
        return {
          shouldSend: true,
          suggested: true,
          reason: 'high-semantic-match',
          mode: 'auto',
          score: 0.9,
          asset: memeCandidates.find((item) => item.assetId === 'provider-global'),
          recordSent: () => {},
        };
      },
      chat: async (_messages, _systemPrompt, userTurn) => JSON.stringify({
        text: `reply:${userTurn}`,
        sendVoice: false,
      }),
    }),
  });

  assert.deepEqual(seenCandidateIds, ['semantic-memory', 'provider-global']);
  assert.deepEqual(structuredReplies[0][1], { type: 'image', image: { file: 'memes/global.png' } });
});

test('processIncomingMessage retries a local meme file as base64 when file send fails', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yuno-workflow-meme-'));
  try {
    const filePath = path.join(dir, 'local.png');
    const fileBytes = Buffer.from('local-image-bytes');
    await writeFile(filePath, fileBytes);

    const event = createEvent({
      chatType: 'group',
      chatId: 'fallback-group',
      rawText: '[CQ:at,qq=bot] 笑死',
      text: '笑死',
      mentionsBot: true,
    });
    const structuredReplies = [];
    const textReplies = [];
    const usedMemes = [];

    await processIncomingMessage(event, createPrecomputedContext(event, {
      analysis: {
        shouldRespond: true,
        confidence: 0.95,
        intent: 'chat',
        sentiment: 'positive',
        relevance: 0.9,
        reason: 'basic-direct-mention-pass',
        topics: ['meme'],
        ruleSignals: ['direct-mention'],
        replyStyle: 'playful',
      },
    }), {
      deps: createWorkflowDeps({
        sendReply: async (_target, text) => textReplies.push(text),
        sendStructuredReply: async (_target, outputs) => {
          structuredReplies.push(outputs);
          if (outputs[1]?.image?.file === filePath) {
            throw new Error('napcat cannot read local file');
          }
          return true;
        },
        markMemeUsed: async (assetId) => usedMemes.push(assetId),
        planContextualMemeReply: () => ({
          shouldSend: true,
          suggested: true,
          reason: 'high-semantic-match',
          mode: 'auto',
          score: 0.9,
          asset: {
            assetId: 'local-meme',
            storagePath: filePath,
          },
          recordSent: () => {},
        }),
        chat: async (_messages, _systemPrompt, userTurn) => JSON.stringify({
          text: `reply:${userTurn}`,
          sendVoice: false,
        }),
      }),
    });

    assert.equal(textReplies.length, 0);
    assert.equal(structuredReplies.length, 2);
    assert.equal(structuredReplies[0][1].image.file, filePath);
    assert.equal(structuredReplies[1][1].image.base64, fileBytes.toString('base64'));
    assert.deepEqual(usedMemes, ['local-meme']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test('processIncomingMessage sends voice when user sends record in private chat', async () => {
  const event = createEvent({
    rawText: '[CQ:record,file=voice.silk]',
    text: '',
    attachments: [{ type: 'record', data: { file: 'voice.silk' } }],
  });
  const sentVoices = [];
  const ttsInputs = [];

  await processIncomingMessage(event, createPrecomputedContext(event), {
    deps: createWorkflowDeps({
      sendVoice: async (_target, audio) => {
        sentVoices.push(audio.toString());
        return true;
      },
      tts: async (text) => {
        ttsInputs.push(text);
        return Buffer.from(`audio:${text}`);
      },
      chat: async () => JSON.stringify({
        text: '听到了，我先陪你把这句接住。',
        sendVoice: false,
      }),
    }),
  });

  assert.deepEqual(ttsInputs, ['听到了，我先陪你把这句接住。']);
  assert.deepEqual(sentVoices, ['audio:听到了，我先陪你把这句接住。']);
});

test('processIncomingMessage skips voice when generated voice text is too long', async () => {
  const event = createEvent({
    rawText: 'say a long thing',
    text: 'say a long thing',
  });
  const sentVoices = [];
  const longText = [
    '这段我先完整说明一下。',
    '第一点是语音只适合短句陪伴，不适合把所有信息都念出来。',
    '第二点是群聊里如果直接发很长语音，会打断其他人的聊天节奏。',
    '第三点是知识型回答本来就更适合文字留档，所以这里应该保留文字回复。',
  ].join('');

  await processIncomingMessage(event, createPrecomputedContext(event), {
    deps: createWorkflowDeps({
      sendVoice: async (_target, audio) => {
        sentVoices.push(audio.toString());
        return true;
      },
      tts: async (text) => Buffer.from(`audio:${text}`),
      chat: async () => JSON.stringify({
        text: longText,
        sendVoice: true,
        voiceText: longText,
      }),
    }),
  });

  assert.equal(sentVoices.length, 0);
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

test('processIncomingMessage does not throttle consecutive group replies from the same user', async () => {
  const sentReplies = [];
  const persistedMessages = [];
  const event = createEvent({
    chatType: 'group',
    chatId: 'burst-group',
    rawText: '[CQ:at,qq=bot] keep talking',
    text: 'keep talking',
    mentionsBot: true,
  });
  const precomputed = createPrecomputedContext(event, {
    analysis: {
      shouldRespond: true,
      confidence: 0.92,
      intent: 'chat',
      sentiment: 'neutral',
      relevance: 0.82,
      reason: 'basic-direct-mention-pass',
      topics: ['chat'],
      ruleSignals: ['direct-mention'],
      replyStyle: 'calm',
    },
  });

  const deps = createWorkflowDeps({
    sendReply: async (_target, text) => {
      sentReplies.push(text);
    },
    appendConversationMessages: async (_session, messages) => {
      persistedMessages.push(messages);
      return { rollingSummary: 'summary', messages };
    },
    chat: async (_messages, _systemPrompt, userTurn) => JSON.stringify({
      text: `reply:${userTurn}:${sentReplies.length}`,
      sendVoice: false,
      voiceText: '',
    }),
  });

  const first = await processIncomingMessage(event, precomputed, { deps });
  const second = await processIncomingMessage({
    ...event,
    messageId: 'msg-2',
    timestamp: event.timestamp + 1000,
  }, precomputed, { deps });
  const third = await processIncomingMessage({
    ...event,
    messageId: 'msg-3',
    timestamp: event.timestamp + 2000,
  }, precomputed, { deps });

  assert.equal(first.startsWith('reply:'), true);
  assert.equal(second.startsWith('reply:'), true);
  assert.equal(third.startsWith('reply:'), true);
  assert.equal(sentReplies.length, 3);
  assert.equal(sentReplies.some((text) => text.includes('慢一点说')), false);
  assert.equal(persistedMessages.length, 3);
});
