import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileSummary, extractStableProfileUpdate } from './src/profile-memory.js';
import { buildReplyContext } from './src/prompt-builder.js';
import { analyzeMemeAssetSemantics, collectMemeAssetForEvent } from './src/meme-collector.js';
import { extractUserMemoryEvents, persistUserMemoryEvents } from './src/user-memory-events.js';
import { retrieveMemoryContext } from './src/memory-retrieval.js';

test('extractStableProfileUpdate captures speaking style and response preference', () => {
  const result = extractStableProfileUpdate('你回复直接一点，详细一点，我平时爱说笑死和QAQ。', {
    confidence: 0.92,
  });

  assert.equal(result.shouldPersist, true);
  assert.equal(result.update.responsePreference, 'detailed');
  assert.equal(result.update.emojiStyle, 'expressive-text');
  assert.match(result.update.frequentPhrases.join(','), /笑死|QAQ/i);
  assert.match(result.update.speakingStyleSummary, /直接|展开|颜文字|语气词/);
});

test('buildProfileSummary includes style-learning fields', () => {
  const summary = buildProfileSummary({
    preferredName: '阿明',
    speakingStyleSummary: '偏短句表达，爱玩梗',
    frequentPhrases: ['笑死', 'QAQ'],
    responsePreference: 'detailed',
    emojiStyle: 'expressive-text',
    humorStyle: 'meme-heavy',
  });

  assert.match(summary, /偏短句表达/);
  assert.match(summary, /笑死/);
  assert.match(summary, /detailed/);
});

test('extractUserMemoryEvents keeps explicit important events and drops chatter', () => {
  const important = extractUserMemoryEvents({
    event: { userName: 'Alice' },
    text: '记住这周三我有面试，别忘了提醒我。',
    analysis: { confidence: 0.9, relevance: 0.88, sentiment: 'neutral', intent: 'help' },
  });
  const chatter = extractUserMemoryEvents({
    event: { userName: 'Alice' },
    text: '今天也就那样吧',
    analysis: { confidence: 0.6, relevance: 0.4, sentiment: 'neutral', intent: 'chat' },
  });

  assert.equal(important.length, 1);
  assert.equal(important[0].eventType, 'promise');
  assert.match(important[0].summary, /面试/);
  assert.equal(chatter.length, 0);
});

test('persistUserMemoryEvents writes expiresAt and embeddingSourceText', async () => {
  const created = [];
  const result = await persistUserMemoryEvents({
    event: {
      platform: 'qq',
      userId: 'u1',
      chatId: 'c1',
      chatType: 'private',
      userName: 'Alice',
      messageId: 'm1',
    },
    text: '记住我下周要答辩。',
    analysis: { confidence: 0.95, relevance: 0.9, sentiment: 'neutral', intent: 'help' },
  }, {
    model: {
      create: async (payload) => {
        created.push(payload);
        return payload;
      },
    },
  });

  assert.equal(result.length, 1);
  assert.ok(created[0].expiresAt instanceof Date);
  assert.match(created[0].embeddingSourceText, /答辩/);
});

test('collectMemeAssetForEvent stores semantic meme fields', async () => {
  const created = [];
  const updated = [];
  const result = await collectMemeAssetForEvent({
    platform: 'qq',
    chatId: 'g1',
    userId: 'u1',
    userName: 'Alice',
    messageId: 'm1',
    chatType: 'group',
    rawText: '笑死，这张图存一下',
    text: '笑死，这张图存一下',
    sender: {},
    attachments: [{
      type: 'image',
      data: { file: 'memes/a.png' },
    }],
  }, {}, {
    model: {
      create: async (payload) => {
        created.push(payload);
        return payload;
      },
      findOneAndUpdate: async (_query, changes) => {
        updated.push(changes.$set);
        return { ...created[0], ...changes.$set };
      },
    },
  });

  assert.equal(result.collected, true);
  assert.equal(created.length, 1);
  assert.match(updated[0].caption, /笑死|tags:/);
  assert.ok(Array.isArray(updated[0].semanticTags));
  assert.ok(updated[0].embeddingSourceText.length > 0);
});

test('analyzeMemeAssetSemantics honors optional OCR and caption generators', async () => {
  const updated = await analyzeMemeAssetSemantics({
    assetId: 'asset-1',
    tags: ['funny'],
    quoteText: '原始文本',
  }, {
    chatType: 'private',
    rawText: '做成图',
    text: '做成图',
  }, {
    model: {
      findOneAndUpdate: async (_query, changes) => ({
        assetId: 'asset-1',
        ...changes.$set,
      }),
    },
    extractMemeOcr: async () => '截图里的字',
    generateMemeCaption: async () => ({
      caption: '一张吐槽风格的聊天截图',
      semanticTags: ['sarcastic', 'chat-log'],
    }),
  });

  assert.match(updated.caption, /聊天截图/);
  assert.match(updated.ocrText, /截图里的字/);
  assert.match(updated.semanticTags.join(','), /sarcastic/);
});

test('retrieveMemoryContext returns active memory events and meme semantics by semantic hits', async () => {
  const result = await retrieveMemoryContext({
    userId: 'u1',
    userTurn: '我又在紧张面试了',
    limitEvents: 2,
    limitMemes: 1,
    now: new Date('2026-04-28T00:00:00Z'),
  }, {
    searchPoints: async (_vector, options) => {
      if (options.filter.must[0].match.value === 'memory_event') {
        return [{ payload: { memoryId: 'mem-1' } }];
      }
      return [{ payload: { assetId: 'asset-1' } }];
    },
    createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
    memoryModel: {
      find: async () => [{
        memoryId: 'mem-1',
        summary: 'Alice提到这周有面试',
        expiresAt: new Date('2026-05-10T00:00:00Z'),
      }],
    },
    memeModel: {
      find: async () => [{
        assetId: 'asset-1',
        caption: '紧张时会发的无语表情',
        usageContext: 'stress-reaction',
        semanticTags: ['stressed'],
        expiresAt: new Date('2026-05-10T00:00:00Z'),
      }],
    },
  });

  assert.equal(result.eventMemories.length, 1);
  assert.equal(result.memeMemories.length, 1);
  assert.match(result.eventMemories[0].summary, /面试/);
  assert.match(result.memeMemories[0].caption, /无语表情/);
});

test('buildReplyContext includes long-term style, event, and meme memory sections', () => {
  const prompt = buildReplyContext({
    event: {
      platform: 'qq',
      chatType: 'private',
      chatId: 'u1',
      userId: 'u1',
      userName: 'Alice',
    },
    route: { category: 'private_chat' },
    relation: { affection: 60, memorySummary: '熟悉的聊天对象' },
    userState: { currentEmotion: 'CALM' },
    userProfile: {
      profileSummary: '偏好温柔语气',
      favoriteTopics: ['游戏'],
      dislikes: ['剧透'],
      speakingStyleSummary: '偏短句，爱玩梗',
      frequentPhrases: ['笑死', 'QAQ'],
      responsePreference: 'detailed',
      emojiStyle: 'expressive-text',
      specialBondSummary: '',
    },
    conversationState: { rollingSummary: '刚聊过工作压力', messages: [] },
    groupState: null,
    recentEvents: [],
    memoryContext: {
      eventMemories: [{ summary: 'Alice提到这周有面试' }],
      memeMemories: [{ caption: '压力大时爱发无语图', usageContext: 'stress-reaction', semanticTags: ['stressed'] }],
    },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', relevance: 0.8, ruleSignals: ['private-chat'] },
    emotionResult: { intensity: 0.4, toneHints: ['calm'] },
    knowledge: { documents: [] },
    isAdmin: false,
    replyLengthProfile: { performanceProfile: 'standard_chat', promptProfile: 'standard', guidance: '自然回答' },
    replyPlan: { type: 'direct', depth: 'short', questionNeeded: false },
  });

  assert.match(prompt, /说话风格|长期记忆/);
  assert.match(prompt, /面试/);
  assert.match(prompt, /无语图|stress-reaction|stressed/);
});
