import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteKnowledgePointsByIds,
  ensureQdrantCollection,
  getQdrantStatus,
  scrollKnowledgePoints,
  searchKnowledge,
  setKnowledgeManifest,
  upsertKnowledgePoints,
} from './src/qdrant-client.js';

const disabled = { url: '', collection: '' };

function runtime(httpClient) {
  return {
    url: 'http://qdrant.invalid',
    collection: 'knowledge',
    apiKey: 'qdrant-secret',
    httpClient,
  };
}

test('Qdrant helpers degrade cleanly when not configured', async () => {
  assert.deepEqual(await ensureQdrantCollection(3, disabled), { enabled: false });
  assert.deepEqual(await upsertKnowledgePoints([{ id: 1 }], disabled), { enabled: false, count: 0 });
  assert.deepEqual(await scrollKnowledgePoints(null, 5, null, disabled), { points: [], nextOffset: null });
  assert.deepEqual(await deleteKnowledgePointsByIds([], disabled), { enabled: false, count: 0 });
  assert.deepEqual(await setKnowledgeManifest({ hash: 'x' }, 2, disabled), { enabled: false });
  assert.deepEqual(await searchKnowledge([1, 2], disabled), []);
  assert.deepEqual(getQdrantStatus(disabled), { enabled: false, collection: '' });
});

test('ensureQdrantCollection reads existing vector configurations', async () => {
  const calls = [];
  const existing = await ensureQdrantCollection(4, runtime(async (request) => {
    calls.push(request);
    return { data: { result: { config: { params: { vectors: { text: { size: 8 } } } } } } };
  }));

  assert.deepEqual(existing, { enabled: true, created: false, vectorSize: 8 });
  assert.equal(calls[0].url, 'http://qdrant.invalid/collections/knowledge');
  assert.deepEqual(calls[0].headers, { 'api-key': 'qdrant-secret' });
});

test('ensureQdrantCollection creates a missing collection and handles create races', async () => {
  const createCalls = [];
  const created = await ensureQdrantCollection(6, {
    ...runtime(async (request) => {
      createCalls.push(request);
      if (request.method === 'get') {
        const error = new Error('missing');
        error.response = { status: 404 };
        throw error;
      }
      return { data: { result: true } };
    }),
    distance: 'Dot',
  });
  assert.deepEqual(created, { enabled: true, created: true, vectorSize: 6 });
  assert.deepEqual(createCalls[1].data, { vectors: { size: 6, distance: 'Dot' } });

  let requestCount = 0;
  const raced = await ensureQdrantCollection(6, runtime(async (request) => {
    requestCount += 1;
    if (requestCount === 1) {
      const error = new Error('missing');
      error.response = { status: 404 };
      throw error;
    }
    if (requestCount === 2) {
      const error = new Error('already exists');
      error.response = { status: 409 };
      throw error;
    }
    return { data: { result: { config: { params: { vectors: { size: 6 } } } } } };
  }));
  assert.deepEqual(raced, { enabled: true, created: false, vectorSize: 6 });
});

test('Qdrant point operations preserve request and response contracts', async () => {
  const calls = [];
  const options = runtime(async (request) => {
    calls.push(request);
    if (request.url.endsWith('/scroll')) {
      return { data: { result: { points: [{ id: 'p1' }], next_page_offset: 'next' } } };
    }
    if (request.url.endsWith('/search')) {
      return { data: { result: [{ id: 'hit', score: 0.9 }] } };
    }
    return { data: { result: true } };
  });

  assert.deepEqual(await upsertKnowledgePoints([{ id: 'p1' }], options), { enabled: true, count: 1 });
  assert.deepEqual(await scrollKnowledgePoints({ must: [] }, 10, 'offset', options), {
    points: [{ id: 'p1' }], nextOffset: 'next',
  });
  assert.deepEqual(await deleteKnowledgePointsByIds([], options), { enabled: true, count: 0 });
  assert.deepEqual(await deleteKnowledgePointsByIds(['p1'], options), { enabled: true, count: 1 });
  assert.deepEqual(await setKnowledgeManifest({ contentHash: 'abc' }, 3, options), { enabled: true });
  assert.deepEqual(await searchKnowledge([0.1, 0.2], { ...options, limit: 2, scoreThreshold: 0.5 }), [
    { id: 'hit', score: 0.9 },
  ]);

  const manifestCall = calls.find((call) => call.data?.points?.[0]?.payload?.type === 'manifest');
  assert.deepEqual(manifestCall.data.points[0].vector, [0, 0, 0]);
  const searchCall = calls.find((call) => call.url.endsWith('/search'));
  assert.equal(searchCall.data.limit, 2);
  assert.equal(searchCall.data.score_threshold, 0.5);
  assert.deepEqual(getQdrantStatus(options), { enabled: true, collection: 'knowledge' });
});
