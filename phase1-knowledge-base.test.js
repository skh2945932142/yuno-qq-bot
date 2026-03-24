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
  const result = await retrieveKnowledge('教导我', {
    createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
    getQdrantStatus: () => ({ enabled: true }),
    searchKnowledge: async () => ([
      {
        id: 'general',
        score: 0.92,
        payload: {
          text: '普通人格设定',
          category: 'persona',
          title: '普通人格',
          tags: ['persona'],
          source: 'knowledge/persona/core.md',
        },
      },
      {
        id: 'special',
        score: 0.8,
        payload: {
          text: 'Scathach 专属关系设定',
          category: 'persona',
          title: '专属关系',
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
