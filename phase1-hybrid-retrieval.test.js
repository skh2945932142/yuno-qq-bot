import test from 'node:test';
import assert from 'node:assert/strict';
import { embedHybridTexts, rerankHybridCandidates } from './src/retrieval-gateway.js';
import { fuseReciprocalRank, retrieveHybridContext } from './src/retrieval-pipeline.js';
import { rewriteRetrievalQuery } from './src/retrieval-query.js';
import { recordInboundMessageLog } from './src/message-log.js';

test('Retrieval Gateway normalizes hybrid embeddings and rerank results', async () => {
  const httpClient = {
    post: async (url) => {
      if (url.endsWith('/v1/embed')) {
        return { data: { data: [{ id: '0', dense: [0.1, 0.2], sparse: { indices: [4], values: [0.9] } }] } };
      }
      return { data: { data: [{ id: 'doc-1', score: 0.93 }] } };
    },
  };
  const embeddings = await embedHybridTexts(['群文件怎么进'], {
    url: 'https://gateway.invalid', embeddingModel: 'bge-m3', rerankModel: 'reranker', httpClient,
  });
  assert.deepEqual(embeddings[0].sparse, { indices: [4], values: [0.9] });
  const reranked = await rerankHybridCandidates('群文件怎么进', [{ id: 'doc-1', text: '群文件入口说明' }], {
    url: 'https://gateway.invalid', embeddingModel: 'bge-m3', rerankModel: 'reranker', httpClient,
  });
  assert.deepEqual(reranked, [{ id: 'doc-1', score: 0.93 }]);
});

test('Hybrid fusion retains lexical-only hits and reranks candidates', async () => {
  const fused = fuseReciprocalRank(
    [{ id: 'dense', payload: { text: '语义命中' } }],
    [{ id: 'lexical', payload: { text: 'AWSL 专名命中' } }, { id: 'dense', payload: { text: '语义命中' } }]
  );
  assert.equal(fused.length, 2);
  const result = await retrieveHybridContext({
    query: 'AWSL 是什么',
    filter: { must: [] },
    limit: 1,
  }, {
    forceEnabled: true,
    config: { retrievalEmbeddingModel: 'bge-m3', retrievalVectorCacheTtlMs: 0, retrievalKnowledgeCacheTtlMs: 0, retrievalCandidateLimit: 20, retrievalRerankLimit: 12 },
    embedHybridTexts: async () => [{ dense: [0.1], sparse: { indices: [1], values: [1] } }],
    searchHybridPoints: async () => ({ dense: [{ id: 'dense', payload: { text: '普通解释' } }], lexical: [{ id: 'lexical', payload: { text: 'AWSL 专名解释' } }] }),
    rerankHybridCandidates: async () => [{ id: 'lexical', score: 0.99 }, { id: 'dense', score: 0.1 }],
  });
  assert.equal(result.hits[0].id, 'lexical');
});

test('Query rewrite uses raw query when the model response is invalid', async () => {
  const result = await rewriteRetrievalQuery({
    event: { chatType: 'group', chatId: 'g1', userId: 'u1' },
    route: { retrievalMode: 'knowledge' },
    userTurn: '那软件怎么用？',
  }, {
    config: { retrievalQueryRewriteEnabled: true, retrievalQueryRewriteTimeoutMs: 100, retrievalQueryRewriteCacheTtlMs: 0 },
    chat: async () => 'not-json',
  });
  assert.equal(result.query, '那软件怎么用？');
  assert.equal(result.rewritten, false);
});

test('MessageLog stores every inbound event through an idempotent key', async () => {
  let write;
  await recordInboundMessageLog({
    platform: 'qq', chatType: 'group', chatId: 'g1', userId: 'u1', messageId: 'm1', rawText: 'hello', attachments: [{ type: 'image', file: 'x.png' }],
  }, {
    model: { findOneAndUpdate: async (filter, update, options) => { write = { filter, update, options }; return write; } },
  });
  assert.equal(write.filter.messageKey, 'in:qq:g1:m1');
  assert.equal(write.update.$setOnInsert.role, 'user');
  assert.deepEqual(write.update.$setOnInsert.attachments, [{ type: 'image', name: 'x.png', size: 0 }]);
});
