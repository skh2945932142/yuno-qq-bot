import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryRecord, UserMemoryEvent } from './src/models.js';
import { touchReferencedMemoryEvents } from './src/user-memory-events.js';
import { cleanupExpiredMemoryVectors, retrieveMemoryContext } from './src/memory-retrieval.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function findTtlIndex(model, field) {
  return model.schema.indexes().find(([fields, options]) => (
    Object.keys(fields).length === 1
    && fields[field] !== undefined
    && options?.expireAfterSeconds !== undefined
  ));
}

test('UserMemoryEvent expiry is enforced by a TTL index', () => {
  const ttl = findTtlIndex(UserMemoryEvent, 'expiresAt');
  assert.ok(ttl, 'expiresAt needs a TTL index or expired memories accumulate forever');
  assert.equal(ttl[1].expireAfterSeconds, 0);
});

test('DeliveryRecord has a bounded retention window', () => {
  const ttl = findTtlIndex(DeliveryRecord, 'createdAt');
  assert.ok(ttl, 'delivery records are written per reply and need retention');
  assert.ok(ttl[1].expireAfterSeconds > 0);
  assert.ok(ttl[1].expireAfterSeconds <= 30 * 24 * 60 * 60);
});

test('touchReferencedMemoryEvents renews expiry and records the reference time', async () => {
  const now = new Date('2026-08-02T00:00:00.000Z');
  const calls = [];
  const model = {
    async updateMany(filter, update) {
      calls.push({ filter, update });
      return { modifiedCount: filter.memoryId.$in.length };
    },
  };

  const result = await touchReferencedMemoryEvents(
    [{ memoryId: 'm1', importanceScore: 0.5 }],
    { now },
    { model }
  );

  assert.equal(result.touched, 1);
  assert.deepEqual(calls[0].filter, { memoryId: { $in: ['m1'] } });
  assert.equal(calls[0].update.$set.lastReferencedAt, now);
  // Standard importance renews the 30 day window from the moment of use.
  assert.equal(calls[0].update.$set.expiresAt.getTime(), now.getTime() + (30 * DAY_MS));
});

test('touchReferencedMemoryEvents keeps the longer window for high importance', async () => {
  const now = new Date('2026-08-02T00:00:00.000Z');
  const calls = [];
  const model = {
    async updateMany(filter, update) {
      calls.push({ ids: filter.memoryId.$in, expiresAt: update.$set.expiresAt });
    },
  };

  await touchReferencedMemoryEvents(
    [
      { memoryId: 'low', importanceScore: 0.5 },
      { memoryId: 'high', importanceScore: 0.95 },
    ],
    { now },
    { model }
  );

  const low = calls.find((call) => call.ids.includes('low'));
  const high = calls.find((call) => call.ids.includes('high'));
  assert.equal(low.expiresAt.getTime(), now.getTime() + (30 * DAY_MS));
  assert.equal(high.expiresAt.getTime(), now.getTime() + (60 * DAY_MS));
});

test('touchReferencedMemoryEvents ignores entries without an id', async () => {
  let called = false;
  const result = await touchReferencedMemoryEvents(
    [{ importanceScore: 0.9 }, { memoryId: '  ' }],
    {},
    { model: { async updateMany() { called = true; } } }
  );

  assert.equal(result.touched, 0);
  assert.equal(called, false);
});

test('cleanupExpiredMemoryVectors deletes vectors whose document is gone or expired', async () => {
  const now = new Date('2026-08-02T00:00:00.000Z');
  const deleted = [];
  const scrolled = [];

  const points = {
    memory_event: [
      { id: 'p-alive', payload: { type: 'memory_event', memoryId: 'alive' } },
      { id: 'p-expired', payload: { type: 'memory_event', memoryId: 'expired' } },
      { id: 'p-missing', payload: { type: 'memory_event', memoryId: 'missing' } },
      { id: 'p-no-id', payload: { type: 'memory_event' } },
    ],
    meme_semantic: [
      { id: 'p-meme-alive', payload: { type: 'meme_semantic', assetId: 'meme-alive' } },
      { id: 'p-meme-disabled', payload: { type: 'meme_semantic', assetId: 'meme-disabled' } },
    ],
  };

  const result = await cleanupExpiredMemoryVectors({ now }, {
    scrollPoints: async (filter) => {
      const type = filter.must[0].match.value;
      scrolled.push(type);
      return { points: points[type] || [], nextOffset: null };
    },
    deletePoints: async (ids) => { deleted.push(...ids); },
    memoryModel: {
      async find(query) {
        // Only 'alive' satisfies the not-yet-expired condition.
        return query[Object.keys(query)[0]].$in
          .filter((id) => id === 'alive')
          .map((memoryId) => ({ memoryId }));
      },
    },
    memeModel: {
      async find(query) {
        assert.equal(query.disabled, false);
        return query.assetId.$in
          .filter((id) => id === 'meme-alive')
          .map((assetId) => ({ assetId }));
      },
    },
  });

  assert.deepEqual(scrolled, ['memory_event', 'meme_semantic']);
  assert.equal(result.enabled, true);
  assert.equal(result.scanned, 6);
  assert.deepEqual(deleted.sort(), ['p-expired', 'p-meme-disabled', 'p-missing', 'p-no-id']);
  assert.equal(deleted.includes('p-alive'), false);
  assert.equal(deleted.includes('p-meme-alive'), false);
});

test('cleanupExpiredMemoryVectors stops when one target fails without losing the other', async () => {
  const deleted = [];
  const result = await cleanupExpiredMemoryVectors({}, {
    scrollPoints: async (filter) => {
      if (filter.must[0].match.value === 'memory_event') {
        throw new Error('qdrant scroll failed');
      }
      return {
        points: [{ id: 'p-meme', payload: { type: 'meme_semantic', assetId: 'gone' } }],
        nextOffset: null,
      };
    },
    deletePoints: async (ids) => { deleted.push(...ids); },
    memoryModel: { async find() { return []; } },
    memeModel: { async find() { return []; } },
  });

  assert.equal(result.enabled, true);
  assert.deepEqual(deleted, ['p-meme']);
});

test('retrieveMemoryContext embeds the user turn once for both lookups', async () => {
  let embedCalls = 0;
  const searchFilters = [];

  const result = await retrieveMemoryContext({
    userId: 'u1',
    chatId: 'c1',
    userTurn: '我下周有个面试',
  }, {
    createEmbeddings: async (input) => {
      embedCalls += 1;
      assert.deepEqual(input, ['我下周有个面试']);
      return [{ embedding: [0.1, 0.2, 0.3] }];
    },
    searchPoints: async (vector, options) => {
      assert.deepEqual(vector, [0.1, 0.2, 0.3]);
      searchFilters.push(options.filter.must[0].match.value);
      return [];
    },
    memoryModel: { async find() { return []; } },
    memeModel: { async find() { return []; } },
  });

  // Both branches score the same text; embedding it twice added a second
  // provider round-trip to the critical path of every single reply.
  assert.equal(embedCalls, 1);
  assert.deepEqual(searchFilters.sort(), ['meme_semantic', 'memory_event']);
  assert.deepEqual(result, { eventMemories: [], memeMemories: [] });
});

test('retrieveMemoryContext skips embedding entirely when the turn is empty', async () => {
  let embedCalls = 0;
  const result = await retrieveMemoryContext({
    userId: 'u1',
    chatId: 'c1',
    userTurn: '   ',
  }, {
    createEmbeddings: async () => { embedCalls += 1; return [{ embedding: [0] }]; },
    searchPoints: async () => [],
    memoryModel: { async find() { return []; } },
    memeModel: { async find() { return []; } },
  });

  assert.equal(embedCalls, 0);
  assert.deepEqual(result, { eventMemories: [], memeMemories: [] });
});
