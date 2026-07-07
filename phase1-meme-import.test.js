import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importLocalMemeDirectory } from './scripts/meme-import.js';
import { GLOBAL_MEME_CHAT_ID } from './src/meme-provider.js';

function createFakeMemeModel() {
  const docs = new Map();
  return {
    docs,
    async findOne(query) {
      return docs.get(String(query.assetId)) || null;
    },
    async create(payload) {
      const doc = { ...payload };
      docs.set(String(payload.assetId), doc);
      return doc;
    },
    async findOneAndUpdate(query, changes) {
      const current = docs.get(String(query.assetId)) || {};
      const next = { ...current, ...(changes.$set || {}) };
      docs.set(String(query.assetId), next);
      return next;
    },
  };
}

test('meme import caches local images as global QQ favorite assets and skips non-images', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yuno-meme-import-'));
  try {
    const imageBytes = Buffer.from('fake-png-content');
    await writeFile(path.join(dir, 'funny-smile.png'), imageBytes);
    await writeFile(path.join(dir, 'notes.txt'), 'not an image');

    const model = createFakeMemeModel();
    const first = await importLocalMemeDirectory({ importDir: dir }, { model });
    const second = await importLocalMemeDirectory({ importDir: dir }, { model });
    const hash = createHash('sha256').update(imageBytes).digest('hex');
    const asset = model.docs.get(`qqfav:${hash}`);

    assert.equal(first.created, 1);
    assert.equal(first.updated, 0);
    assert.equal(first.skipped, 1);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    assert.equal(asset.chatId, GLOBAL_MEME_CHAT_ID);
    assert.equal(asset.origin, 'qq_favorite_cache');
    assert.equal(asset.storagePath, path.resolve(dir, 'funny-smile.png'));
    assert.match(asset.semanticTags.join(','), /funny/);
    assert.match(asset.semanticTags.join(','), /smile/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('meme import manifest overrides tags, caption and disabled fields by relative path', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yuno-meme-manifest-'));
  try {
    await mkdir(path.join(dir, 'nested'));
    const imageBytes = Buffer.from('fake-webp-content');
    await writeFile(path.join(dir, 'nested', 'raw-name.webp'), imageBytes);
    await writeFile(path.join(dir, 'meme-manifest.json'), JSON.stringify({
      files: {
        'nested/raw-name.webp': {
          tags: ['override-tag'],
          semanticTags: ['sarcasm', 'reaction'],
          caption: 'manifest caption',
          usageContext: 'reply after playful teasing',
          emotion: 'sarcastic',
          safetyStatus: 'safe',
          disabled: true,
        },
      },
    }));

    const model = createFakeMemeModel();
    await importLocalMemeDirectory({ importDir: dir }, { model });
    const hash = createHash('sha256').update(imageBytes).digest('hex');
    const asset = model.docs.get(`qqfav:${hash}`);

    assert.deepEqual(asset.tags, ['override-tag']);
    assert.deepEqual(asset.semanticTags, ['sarcasm', 'reaction']);
    assert.equal(asset.caption, 'manifest caption');
    assert.equal(asset.usageContext, 'reply after playful teasing');
    assert.equal(asset.emotion, 'sarcastic');
    assert.equal(asset.disabled, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
