import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKnowledgeDocuments, retrieveKnowledge } from './src/knowledge-base.js';

test('loadKnowledgeDocuments reads markdown files from the knowledge directory', async () => {
  const documents = await loadKnowledgeDocuments();

  assert.ok(documents.length > 0);
  assert.ok(documents.every((item) => item.metadata.category));
  assert.ok(documents.some((item) => item.metadata.category === 'persona'));
});

test('retrieveKnowledge safely returns empty results for empty queries', async () => {
  const result = await retrieveKnowledge('');

  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'empty-query');
  assert.deepEqual(result.documents, []);
});
