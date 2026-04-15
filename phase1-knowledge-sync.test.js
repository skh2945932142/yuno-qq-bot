import test from 'node:test';
import assert from 'node:assert/strict';
import { syncKnowledgeBase } from './src/knowledge-base.js';

test('syncKnowledgeBase upserts documents, removes orphans, and writes a manifest with mocks', async () => {
  let ensuredSize = 0;
  let upsertedPoints = [];
  let manifest = null;
  let orphanLookup = null;

  const result = await syncKnowledgeBase({
    documents: [
      {
        id: 'doc-1',
        text: 'Yuno replies naturally.',
        metadata: {
          category: 'persona',
          title: 'persona',
          source: 'knowledge/persona/core.md',
          chunkIndex: 0,
        },
      },
    ],
    createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
    ensureQdrantCollection: async (vectorSize) => {
      ensuredSize = vectorSize;
    },
    upsertKnowledgePoints: async (points) => {
      upsertedPoints = points;
    },
    deleteOrphanKnowledgePoints: async (validIds) => {
      orphanLookup = validIds;
      return 2;
    },
    setKnowledgeManifest: async (value) => {
      manifest = value;
    },
  });

  assert.equal(ensuredSize, 3);
  assert.equal(upsertedPoints.length, 1);
  assert.equal(orphanLookup.has('doc-1'), true);
  assert.equal(manifest.documentCount, 1);
  assert.equal(result.orphanCount, 2);
  assert.ok(result.version);
});

test('syncKnowledgeBase fails when embedding count does not match document count', async () => {
  await assert.rejects(
    () => syncKnowledgeBase({
      documents: [
        {
          id: 'doc-1',
          text: 'one',
          metadata: { category: 'persona', title: 'one', source: 'one.md', chunkIndex: 0 },
        },
        {
          id: 'doc-2',
          text: 'two',
          metadata: { category: 'persona', title: 'two', source: 'two.md', chunkIndex: 0 },
        },
      ],
      createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
    }),
    /returned 1 vectors for 2 inputs/
  );
});

test('syncKnowledgeBase fails when embedding payload is invalid', async () => {
  await assert.rejects(
    () => syncKnowledgeBase({
      documents: [
        {
          id: 'doc-1',
          text: 'one',
          metadata: { category: 'persona', title: 'one', source: 'one.md', chunkIndex: 0 },
        },
      ],
      createEmbeddings: async () => [{ embedding: [] }],
    }),
    /empty embedding vector/
  );
});
