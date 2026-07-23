import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indexMemeAssetSemantics,
  indexUserMemoryEvents,
  retrieveMemoryContext,
} from './src/memory-retrieval.js';

function embeddingDeps(overrides = {}) {
  return {
    createEmbeddings: async () => [{ embedding: [0.1, 0.2] }],
    upsertPoints: async () => {},
    ...overrides,
  };
}

test('memory retrieval indexing skips empty input and keeps sparse event payloads safe', async () => {
  assert.deepEqual(await indexUserMemoryEvents(null), { enabled: false, count: 0 });
  assert.deepEqual(await indexUserMemoryEvents([{}], embeddingDeps()), { enabled: false, count: 0 });

  const batches = [];
  const result = await indexUserMemoryEvents([{
    memoryId: '',
    userId: null,
    chatId: null,
    groupId: null,
    eventType: '',
    summary: '',
    tags: null,
    importanceScore: null,
    expiresAt: 'not-a-date',
    embeddingSourceText: 'stable source',
  }], embeddingDeps({ upsertPoints: async (points) => batches.push(points) }));

  assert.deepEqual(result, { enabled: true, count: 1 });
  assert.deepEqual(batches[0][0].payload, {
    type: 'memory_event',
    memoryId: '',
    userId: '',
    chatId: '',
    groupId: '',
    eventType: '',
    summary: '',
    tags: [],
    importanceScore: 0,
    expiresAt: '',
  });
});

test('memory retrieval rejects invalid embeddings and indexes sparse meme semantics', async () => {
  await assert.rejects(
    () => indexUserMemoryEvents([{
      memoryId: 'bad-vector',
      embeddingSourceText: 'invalid vector source',
    }], embeddingDeps({ createEmbeddings: async () => [{ embedding: null }] })),
    /invalid memory retrieval vectors/
  );

  assert.deepEqual(await indexMemeAssetSemantics({ embeddingSourceText: '' }, embeddingDeps()), {
    enabled: false,
    count: 0,
  });

  const batches = [];
  const result = await indexMemeAssetSemantics({
    assetId: 'asset-1',
    userId: null,
    chatId: null,
    semanticTags: null,
    caption: '',
    usageContext: '',
    expiresAt: 'invalid',
    embeddingSourceText: 'meme semantic source',
  }, embeddingDeps({ upsertPoints: async (points) => batches.push(points) }));

  assert.deepEqual(result, { enabled: true, count: 1 });
  assert.deepEqual(batches[0][0].payload, {
    type: 'meme_semantic',
    assetId: 'asset-1',
    userId: '',
    chatId: '',
    semanticTags: [],
    caption: '',
    usageContext: '',
    expiresAt: '',
  });
});

test('memory retrieval handles malformed requests, no semantic hits, and provider errors', async () => {
  assert.deepEqual(await retrieveMemoryContext({ userTurn: 'hello' }), {
    eventMemories: [],
    memeMemories: [],
  });
  assert.deepEqual(await retrieveMemoryContext({ userId: 'u1', userTurn: '' }), {
    eventMemories: [],
    memeMemories: [],
  });

  let modelReads = 0;
  const noHits = await retrieveMemoryContext({ userId: 'u1', userTurn: 'nothing relevant' }, {
    searchPoints: async () => [],
    createEmbeddings: async () => [{ embedding: [0.1] }],
    memoryModel: { find: async () => { modelReads += 1; return []; } },
    memeModel: { find: async () => { modelReads += 1; return []; } },
  });
  assert.deepEqual(noHits, { eventMemories: [], memeMemories: [] });
  assert.equal(modelReads, 0);

  const failed = await retrieveMemoryContext({ userId: 'u1', userTurn: 'provider fail' }, {
    searchPoints: async () => { throw new Error('semantic provider unavailable'); },
    createEmbeddings: async () => [{ embedding: [0.1] }],
    memoryModel: { find: async () => [] },
    memeModel: { find: async () => [] },
  });
  assert.deepEqual(failed, { eventMemories: [], memeMemories: [] });
});

test('memory retrieval falls back to user-scoped memes and filters expired documents', async () => {
  const filters = [];
  const result = await retrieveMemoryContext({
    userId: 'u1',
    userTurn: 'remind me about interviews',
    now: new Date('2026-07-23T00:00:00Z'),
  }, {
    searchPoints: async (_vector, options) => {
      filters.push(options.filter.must);
      return options.filter.must[0].match.value === 'memory_event'
        ? [{ payload: { memoryId: 'keep-memory' } }, { payload: { memoryId: 'expired-memory' } }]
        : [{ payload: { assetId: 'keep-meme' } }, { payload: { assetId: 'expired-meme' } }];
    },
    createEmbeddings: async () => [{ embedding: [0.1] }],
    memoryModel: {
      find: async () => [
        { memoryId: 'keep-memory', summary: 'interview preference' },
        { memoryId: 'expired-memory', expiresAt: new Date('2026-07-01T00:00:00Z') },
      ],
    },
    memeModel: {
      find: async () => [
        { assetId: 'keep-meme', caption: 'encouragement' },
        { assetId: 'expired-meme', expiresAt: new Date('invalid') },
      ],
    },
  });

  assert.equal(result.eventMemories.length, 1);
  assert.equal(result.memeMemories.length, 1);
  assert.deepEqual(filters[1][1], { key: 'userId', match: { value: 'u1' } });
});
