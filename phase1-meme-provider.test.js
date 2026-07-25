import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBAL_MEME_CHAT_ID,
  MEME_PROVIDER_ONEBOT_FAVORITES,
  getMemeCandidates,
  resetMemeProviderState,
  syncOnebotFavoriteMemeCache,
} from './src/meme-provider.js';

function createFakeMemeModel(seed = []) {
  const docs = new Map(seed.map((item) => [String(item.assetId), { ...item }]));
  return {
    docs,
    async find(query) {
      const allowed = new Set((query.chatId?.$in || []).map(String));
      return [...docs.values()].filter((item) => (
        allowed.has(String(item.chatId))
        && item.disabled === false
        && item.safetyStatus === 'safe'
        && item.type === 'image'
      ));
    },
    async findOneAndUpdate(query, update) {
      const assetId = String(query.assetId);
      const existing = docs.get(assetId) || {};
      docs.set(assetId, {
        ...existing,
        ...update.$setOnInsert,
        ...update.$set,
      });
      return docs.get(assetId);
    },
  };
}

test('onebot-favorites synchronizes fetch_custom_face through the protocol adapter', async () => {
  resetMemeProviderState();
  const model = createFakeMemeModel();
  const actions = [];

  const result = await syncOnebotFavoriteMemeCache({ count: 2, force: true, nowMs: 1000 }, {
    model,
    callAction: async (action, payload) => {
      actions.push({ action, payload });
      return [
        { file: 'https://example.invalid/a.png', summary: 'A' },
        { file: 'base64://aGk=', summary: 'B' },
      ];
    },
  });

  assert.deepEqual(actions, [{ action: 'fetch_custom_face', payload: { count: 2 } }]);
  assert.deepEqual(result, { enabled: true, reason: 'synced', count: 2 });
  assert.equal([...model.docs.values()].every((item) => item.chatId === GLOBAL_MEME_CHAT_ID), true);

  const candidates = await getMemeCandidates({
    provider: MEME_PROVIDER_ONEBOT_FAVORITES,
    chatId: 'group-1',
    limit: 8,
  }, {
    model,
    callAction: async () => [],
    nowMs: 1001,
    syncTtlMs: 60_000,
  });
  assert.equal(candidates.length, 2);
});

test('onebot-favorites never falls back to vendor-specific collection actions', async () => {
  resetMemeProviderState();
  const model = createFakeMemeModel();
  const actions = [];

  const result = await syncOnebotFavoriteMemeCache({ count: 48, force: true, nowMs: 2000 }, {
    model,
    callAction: async (action) => {
      actions.push(action);
      return [];
    },
  });

  assert.deepEqual(result, { enabled: true, reason: 'synced', count: 0 });
  assert.deepEqual(actions, ['fetch_custom_face']);
});

test('onebot-favorites cache TTL prevents duplicate protocol calls', async () => {
  resetMemeProviderState();
  const model = createFakeMemeModel();
  let calls = 0;
  const deps = {
    model,
    callAction: async () => {
      calls += 1;
      return [{ file: 'https://example.invalid/a.png' }];
    },
  };

  await syncOnebotFavoriteMemeCache({ force: true, nowMs: 3000, syncTtlMs: 60_000 }, deps);
  const cached = await syncOnebotFavoriteMemeCache({ nowMs: 3001, syncTtlMs: 60_000 }, deps);

  assert.equal(calls, 1);
  assert.deepEqual(cached, { enabled: true, reason: 'fresh-cache', count: 1 });
});

test('onebot-favorites reports protocol errors without direct HTTP fallback', async () => {
  resetMemeProviderState();
  const result = await syncOnebotFavoriteMemeCache({ force: true, nowMs: 4000 }, {
    model: createFakeMemeModel(),
    protocolAdapter: {
      callAction: async () => {
        const error = new Error('onebot offline');
        error.code = 'KOISHI_BOT_OFFLINE';
        throw error;
      },
    },
  });

  assert.deepEqual(result, { enabled: false, reason: 'onebot-failed', count: 0 });
});
