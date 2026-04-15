import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKnowledgeDocuments, retrieveKnowledge } from './src/knowledge-base.js';

test('loadKnowledgeDocuments reads markdown files from the knowledge directory', async () => {
  const documents = await loadKnowledgeDocuments();

  assert.ok(documents.length > 0);
  assert.ok(documents.every((item) => item.metadata.category));
  assert.ok(documents.some((item) => item.metadata.category === 'persona'));
  assert.ok(documents.some((item) => (item.metadata.tags || []).includes('special_user:scathach')));
});

test('retrieveKnowledge safely returns empty results for empty queries', async () => {
  const result = await retrieveKnowledge('');

  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'empty-query');
  assert.deepEqual(result.documents, []);
});

test('retrieveKnowledge prioritizes preferred special-user tags when reranking hits', async () => {
  const result = await retrieveKnowledge('teach me', {
    createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
    getQdrantStatus: () => ({ enabled: true }),
    searchKnowledge: async () => ([
      {
        id: 'general',
        score: 0.92,
        payload: {
          text: 'general persona settings',
          category: 'persona',
          title: 'general persona',
          tags: ['persona'],
          source: 'knowledge/persona/core.md',
        },
      },
      {
        id: 'special',
        score: 0.8,
        payload: {
          text: 'Scathach special relationship settings',
          category: 'persona',
          title: 'special relationship',
          tags: ['persona', 'special_user:scathach'],
          source: 'knowledge/persona/scathach.md',
        },
      },
    ]),
    preferredTags: ['special_user:scathach'],
  });

  assert.equal(result.enabled, true);
  assert.equal(result.documents[0].id, 'special');
});

test('retrieveKnowledge returns embedding-empty when embedding provider returns no rows', async () => {
  const result = await retrieveKnowledge('who are you', {
    createEmbeddings: async () => [],
    getQdrantStatus: () => ({ enabled: true }),
  });

  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'embedding-empty');
  assert.deepEqual(result.documents, []);
});

test('retrieveKnowledge returns embedding-invalid when embedding payload is malformed', async () => {
  const result = await retrieveKnowledge('who are you', {
    createEmbeddings: async () => [{ vector: [0.1, 0.2] }],
    getQdrantStatus: () => ({ enabled: true }),
  });

  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'embedding-invalid');
  assert.deepEqual(result.documents, []);
});

test('retrieveKnowledge returns retrieval-failed when qdrant search throws', async () => {
  const result = await retrieveKnowledge('who are you', {
    createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
    getQdrantStatus: () => ({ enabled: true }),
    searchKnowledge: async () => {
      throw new Error('qdrant unavailable');
    },
  });

  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'retrieval-failed');
  assert.deepEqual(result.documents, []);
});
