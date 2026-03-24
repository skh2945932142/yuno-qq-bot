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
        text: '由乃会自然接话。',
        metadata: {
          category: 'persona',
          title: '人格',
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
