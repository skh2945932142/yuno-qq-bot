import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadKnowledgeDocuments, retrieveKnowledge } from './src/knowledge-base.js';

test('loadKnowledgeDocuments reads markdown files from the knowledge directory', async () => {
  const documents = await loadKnowledgeDocuments();

  assert.ok(documents.length > 0);
  assert.ok(documents.every((item) => item.metadata.category));
  assert.ok(documents.some((item) => item.metadata.category === 'persona'));
  assert.ok(documents.some((item) => (item.metadata.tags || []).includes('special_user:scathach')));
});

test('loadKnowledgeDocuments skips README and inherits file metadata into child sections', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yuno-kb-'));
  try {
    await fs.mkdir(path.join(rootDir, 'faq'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'README.md'), [
      '# Knowledge Base',
      '',
      'Tags: docs',
      'Priority: 9',
      '',
      'This operational README should not be embedded.',
    ].join('\n'));
    await fs.writeFile(path.join(rootDir, 'faq', 'common.md'), [
      '# 常见问题',
      '',
      'Tags: faq, support',
      'Priority: 2',
      '',
      '## 你会什么',
      '',
      '由乃擅长闲聊和解释已知设定。',
      '',
      '## 占位',
      '',
      '这里用于补充更多常见问题，待补充。',
    ].join('\n'));

    const documents = await loadKnowledgeDocuments(rootDir);
    const localDocuments = documents.filter((item) => !String(item.metadata.source).includes('builtin-'));
    const answer = localDocuments.find((item) => item.metadata.title === '你会什么');

    assert.ok(answer);
    assert.deepEqual(answer.metadata.tags, ['faq', 'support']);
    assert.equal(answer.metadata.priority, 2);
    assert.doesNotMatch(answer.text, /Tags:|Priority:/);
    assert.equal(localDocuments.some((item) => item.metadata.source.endsWith('README.md')), false);
    assert.equal(localDocuments.some((item) => item.metadata.title === '占位'), false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
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

test('retrieveKnowledge expands candidate limit when preferred tags need reranking', async () => {
  let searchOptions = null;

  await retrieveKnowledge('teach me', {
    createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
    getQdrantStatus: () => ({ enabled: true }),
    searchKnowledge: async (_vector, options) => {
      searchOptions = options;
      return [];
    },
    preferredTags: ['special_user:scathach'],
    limit: 2,
  });

  assert.equal(searchOptions.limit, 6);
});

test('retrieveKnowledge uses priority as a secondary reranking signal', async () => {
  const result = await retrieveKnowledge('rules', {
    createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
    getQdrantStatus: () => ({ enabled: true }),
    searchKnowledge: async () => ([
      {
        id: 'generic',
        score: 0.78,
        payload: {
          text: 'generic rule',
          category: 'rules',
          title: 'generic',
          tags: ['rules'],
          priority: 1,
          source: 'knowledge/rules/generic.md',
        },
      },
      {
        id: 'important',
        score: 0.74,
        payload: {
          text: 'important rule',
          category: 'rules',
          title: 'important',
          tags: ['rules'],
          priority: 5,
          source: 'knowledge/rules/important.md',
        },
      },
    ]),
  });

  assert.equal(result.enabled, true);
  assert.equal(result.documents[0].id, 'important');
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
