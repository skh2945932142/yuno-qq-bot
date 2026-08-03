import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEmbedding, checkOneBot, checkQdrant, checkRetrievalProvider, checkVoiceRuntime, runCheck } from './doctor.js';

test('doctor supports OneBot WebSocket transport', async () => {
  let captured;
  const result = await checkOneBot({
    config: {
      onebotEndpoint: 'ws://llbot:3000',
      onebotTransport: 'ws',
      onebotToken: 'test-token',
      requestTimeoutMs: 1000,
    },
    callWebSocketAction: async (endpoint, token, timeoutMs) => {
      captured = { endpoint, token, timeoutMs };
      return { nickname: 'Yuno', user_id: 3847566155 };
    },
  });

  assert.deepEqual(captured, {
    endpoint: 'ws://llbot:3000',
    token: 'test-token',
    timeoutMs: 1000,
  });
  assert.match(result.detail, /Yuno/);
});

test('doctor marks voice as skip when voice is disabled', async () => {
  const result = await checkVoiceRuntime({
    config: {
      enableVoice: false,
    },
  });

  assert.equal(result.status, 'skip');
  assert.match(result.detail, /text-only mode/i);
});

test('doctor marks qdrant as skip when retrieval is not configured', async () => {
  const result = await checkQdrant({
    config: {
      qdrantUrl: '',
      qdrantCollection: '',
      qdrantApiKey: '',
      requestTimeoutMs: 1000,
    },
  });

  assert.equal(result.status, 'skip');
  assert.match(result.detail, /text-only mode/i);
});

test('doctor marks embedding as skip when retrieval is not configured', async () => {
  const result = await checkEmbedding({
    config: {
      qdrantUrl: '',
      qdrantCollection: '',
      embeddingModel: 'text-embedding-3-small',
      embeddingBaseUrl: 'https://api.openai.com/v1',
      requestTimeoutMs: 1000,
    },
  });

  assert.equal(result.status, 'skip');
  assert.match(result.detail, /not configured/i);
});

test('doctor validates embedding vector shape when retrieval is configured', async () => {
  const result = await checkEmbedding({
    config: {
      qdrantUrl: 'http://127.0.0.1:6333',
      qdrantCollection: 'qq_bot_knowledge',
      embeddingModel: 'text-embedding-3-small',
      embeddingBaseUrl: 'https://api.openai.com/v1',
      requestTimeoutMs: 1000,
    },
    createEmbeddings: async () => [{ embedding: [0.1, 0.2, 0.3] }],
  });

  assert.match(result.detail, /vectorSize=3/);
});

test('doctor fails embedding check when provider returns an empty vector set', async () => {
  const result = await runCheck('embedding', () => checkEmbedding({
    config: {
      qdrantUrl: 'http://127.0.0.1:6333',
      qdrantCollection: 'qq_bot_knowledge',
      embeddingModel: 'text-embedding-3-small',
      embeddingBaseUrl: 'https://api.openai.com/v1',
      requestTimeoutMs: 1000,
    },
    createEmbeddings: async () => [],
  }));

  assert.equal(result.status, 'fail');
  assert.match(result.detail, /invalid vector/i);
});

test('doctor marks qdrant as fail when configured endpoint is unreachable', async () => {
test('doctor validates the SiliconFlow Dense + Rerank retrieval provider', async () => {
  const result = await checkRetrievalProvider({
    config: {
      retrievalHybridEnabled: true,
      retrievalProvider: 'siliconflow',
      embeddingBaseUrl: 'https://api.siliconflow.cn/v1',
      embeddingApiKey: 'siliconflow-key',
      retrievalEmbeddingModel: 'BAAI/bge-m3',
      retrievalRerankModel: 'BAAI/bge-reranker-v2-m3',
    },
    embedHybridTexts: async () => [{ dense: [0.1, 0.2] }],
    rerankHybridCandidates: async () => [{ id: 'probe', score: 0.9 }],
  });

  assert.match(result.detail, /provider=siliconflow/);
  assert.match(result.detail, /mode=dense-rerank/);
});

test('doctor skips retrieval provider checks when retrieval v2 is disabled', async () => {
  const result = await checkRetrievalProvider({
    config: { retrievalHybridEnabled: false },
  });

  assert.equal(result.status, 'skip');
  assert.match(result.detail, /disabled/);
});

test('doctor targets the v2 collection when retrieval v2 is enabled', async () => {
  let requestedUrl = '';
  const result = await checkQdrant({
    config: {
      retrievalHybridEnabled: true,
      qdrantUrl: 'http://qdrant.invalid',
      qdrantHybridCollection: 'qq_bot_retrieval_v2',
      qdrantApiKey: '',
      requestTimeoutMs: 1000,
    },
    httpGet: async (url) => {
      requestedUrl = url;
      return { data: { result: { config: { params: { vectors: { dense: { size: 1024 } } } } } } };
    },
  });

  assert.equal(requestedUrl, 'http://qdrant.invalid/collections/qq_bot_retrieval_v2');
  assert.match(result.detail, /qq_bot_retrieval_v2/);
});

  const result = await runCheck('qdrant', () => checkQdrant({
    config: {
      qdrantUrl: 'http://127.0.0.1:6333',
      qdrantCollection: 'qq_bot_knowledge',
      qdrantApiKey: '',
      requestTimeoutMs: 1000,
    },
    httpGet: async () => {
      const error = new Error('bad gateway');
      error.response = { status: 502 };
      throw error;
    },
  }));

  assert.equal(result.status, 'fail');
  assert.match(result.detail, /bad gateway/i);
});

test('doctor reports invalid qdrant url before making a request', async () => {
  const result = await checkQdrant({
    config: {
      qdrantUrl: 'qdrant:6333',
      qdrantCollection: 'qq_bot_knowledge',
      qdrantApiKey: '',
      requestTimeoutMs: 1000,
    },
    httpGet: async () => {
      throw new Error('should not be called');
    },
  });

  assert.equal(result.status, 'fail');
  assert.match(result.detail, /QDRANT_URL is invalid/);
});
