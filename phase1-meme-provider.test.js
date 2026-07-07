import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMemeCandidates,
  GLOBAL_MEME_CHAT_ID,
  resetMemeProviderState,
} from './src/meme-provider.js';

function createFakeMemeModel(seed = []) {
  const docs = new Map(seed.map((item) => [String(item.assetId), { ...item }]));
  const model = {
    docs,
    async find(query) {
      const allowedChatIds = new Set((query.chatId?.$in || []).map((item) => String(item)));
      return [...docs.values()].filter((item) => {
        if (allowedChatIds.size > 0 && !allowedChatIds.has(String(item.chatId || ''))) {
          return false;
        }
        if (query.disabled !== undefined && Boolean(item.disabled) !== Boolean(query.disabled)) {
          return false;
        }
        if (query.safetyStatus && String(item.safetyStatus || '') !== String(query.safetyStatus)) {
          return false;
        }
        if (query.type && String(item.type || '') !== String(query.type)) {
          return false;
        }
        return true;
      });
    },
    async findOneAndUpdate(query, changes) {
      const assetId = String(query.assetId || '');
      const current = docs.get(assetId) || {};
      const next = {
        ...changes.$setOnInsert,
        ...current,
        ...(changes.$set || {}),
        assetId,
      };
      docs.set(assetId, next);
      return next;
    },
  };
  return model;
}

test('local-cache meme provider returns current chat and global safe assets', async () => {
  const queries = [];
  const assets = [
    { assetId: 'chat-safe', chatId: 'g1', storagePath: 'memes/chat.png', safetyStatus: 'safe', disabled: false },
    { assetId: 'global-safe', chatId: GLOBAL_MEME_CHAT_ID, storagePath: 'memes/global.png', safetyStatus: 'safe', disabled: false },
    { assetId: 'disabled', chatId: 'g1', storagePath: 'memes/disabled.png', safetyStatus: 'safe', disabled: true },
    { assetId: 'unsafe', chatId: GLOBAL_MEME_CHAT_ID, storagePath: 'memes/unsafe.png', safetyStatus: 'blocked', disabled: false },
    { assetId: 'other-chat', chatId: 'g2', storagePath: 'memes/other.png', safetyStatus: 'safe', disabled: false },
  ];

  const result = await getMemeCandidates({
    chatId: 'g1',
    limit: 10,
  }, {
    model: {
      find: async (query) => {
        queries.push(query);
        return assets;
      },
    },
  });

  assert.deepEqual(queries[0].chatId.$in, ['g1', GLOBAL_MEME_CHAT_ID]);
  assert.deepEqual(result.map((item) => item.assetId), ['chat-safe', 'global-safe']);
});

test('napcat-favorites provider fetches custom faces from NapCat and caches global assets', async () => {
  resetMemeProviderState();
  const actions = [];
  const model = createFakeMemeModel();

  const result = await getMemeCandidates({
    chatId: 'g1',
    provider: 'napcat-favorites',
    limit: 2,
  }, {
    model,
    postNapcat: async (action, payload) => {
      actions.push({ action, payload });
      return {
        data: {
          data: [
            'https://example.com/faces/smile.png',
            'D:/qq/faces/funny.webp',
          ],
        },
      };
    },
    nowMs: 1000,
  });

  assert.deepEqual(actions, [{ action: 'fetch_custom_face', payload: { count: 48 } }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].origin, 'napcat_favorite_cache');
  assert.equal(result[0].chatId, GLOBAL_MEME_CHAT_ID);
  assert.equal(result[0].imageUrl, 'https://example.com/faces/smile.png');
  assert.equal(result[1].storagePath, 'D:/qq/faces/funny.webp');
  assert.ok([...model.docs.keys()].every((assetId) => assetId.startsWith('napcatfav:')));
});

test('napcat-favorites provider falls back to get_collection_list when custom face list is empty', async () => {
  resetMemeProviderState();
  const actions = [];
  const model = createFakeMemeModel();

  const result = await getMemeCandidates({
    chatId: 'g1',
    provider: 'napcat-favorites',
    limit: 3,
  }, {
    model,
    postNapcat: async (action, payload) => {
      actions.push({ action, payload });
      if (action === 'fetch_custom_face') {
        return { data: { data: [] } };
      }
      return {
        data: {
          data: [{
            file: 'https://example.com/collection/reaction.gif',
            name: 'reaction',
            md5: 'face-md5',
          }],
        },
      };
    },
    nowMs: 1000,
  });

  assert.deepEqual(actions.map((item) => item.action), ['fetch_custom_face', 'get_collection_list']);
  assert.equal(result.length, 1);
  assert.equal(result[0].assetId, 'napcatfav:face-md5');
  assert.equal(result[0].imageUrl, 'https://example.com/collection/reaction.gif');
  assert.match(result[0].semanticTags.join(','), /reaction/);
});

test('napcat-favorites provider uses cached global assets within sync ttl', async () => {
  resetMemeProviderState();
  const model = createFakeMemeModel();
  let calls = 0;

  await getMemeCandidates({
    chatId: 'g1',
    provider: 'napcat-favorites',
    limit: 1,
  }, {
    model,
    postNapcat: async () => {
      calls += 1;
      return { data: { data: ['https://example.com/faces/first.png'] } };
    },
    nowMs: 1000,
    syncTtlMs: 60000,
  });
  const second = await getMemeCandidates({
    chatId: 'g1',
    provider: 'napcat-favorites',
    limit: 1,
  }, {
    model,
    postNapcat: async () => {
      calls += 1;
      return { data: { data: ['https://example.com/faces/second.png'] } };
    },
    nowMs: 2000,
    syncTtlMs: 60000,
  });

  assert.equal(calls, 1);
  assert.deepEqual(second.map((item) => item.imageUrl), ['https://example.com/faces/first.png']);
});
