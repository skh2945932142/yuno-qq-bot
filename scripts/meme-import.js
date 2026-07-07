import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { connectDB } from '../src/db.js';
import { MemeAsset } from '../src/models.js';
import { GLOBAL_MEME_CHAT_ID } from '../src/meme-provider.js';

export const SUPPORTED_MEME_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
]);

const MANIFEST_FILE = 'meme-manifest.json';

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeStringList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,，;；\s]+/);
  return [...new Set(source
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
}

function deriveTagsFromRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const withoutExt = normalized.replace(/\.[^.]+$/, '');
  return normalizeStringList(withoutExt.split(/[\\/_.\-\s()[\]{}]+/));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function readManifestEntry(manifest, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return manifest?.files?.[normalized] || manifest?.[normalized] || {};
}

async function readManifest(importDir) {
  try {
    const raw = await readFile(path.join(importDir, MANIFEST_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function collectFiles(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, baseDir));
      continue;
    }
    if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: normalizeRelativePath(path.relative(baseDir, absolutePath)),
      });
    }
  }
  return files;
}

function buildEmbeddingSourceText(payload) {
  return [
    payload.caption,
    payload.usageContext,
    ...(payload.semanticTags || []),
    ...(payload.tags || []),
  ].map((item) => String(item || '').trim()).filter(Boolean).join(' ');
}

function buildImportPayload({ importDir, file, bytes, manifest }) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const manifestEntry = readManifestEntry(manifest, file.relativePath);
  const derivedTags = deriveTagsFromRelativePath(file.relativePath);
  const tags = hasOwn(manifestEntry, 'tags')
    ? normalizeStringList(manifestEntry.tags)
    : derivedTags;
  const semanticTags = hasOwn(manifestEntry, 'semanticTags')
    ? normalizeStringList(manifestEntry.semanticTags)
    : derivedTags;
  const payload = {
    assetId: `qqfav:${hash}`,
    platform: 'qq',
    chatId: GLOBAL_MEME_CHAT_ID,
    userId: '',
    sourceMessageId: '',
    type: 'image',
    origin: 'qq_favorite_cache',
    quoteText: '',
    imageUrl: '',
    storagePath: path.resolve(importDir, file.relativePath),
    avatarUrl: '',
    tags,
    ocrText: '',
    caption: hasOwn(manifestEntry, 'caption') ? String(manifestEntry.caption || '') : '',
    semanticTags,
    usageContext: hasOwn(manifestEntry, 'usageContext') ? String(manifestEntry.usageContext || '') : '',
    emotion: hasOwn(manifestEntry, 'emotion') ? String(manifestEntry.emotion || 'funny') : 'funny',
    safetyStatus: hasOwn(manifestEntry, 'safetyStatus') ? String(manifestEntry.safetyStatus || 'safe') : 'safe',
    disabled: hasOwn(manifestEntry, 'disabled') ? Boolean(manifestEntry.disabled) : false,
    lastUsedAt: null,
    lastAnalyzedAt: null,
    expiresAt: null,
  };
  payload.embeddingSourceText = buildEmbeddingSourceText(payload);
  return payload;
}

async function upsertMemeAsset(payload, model) {
  if (typeof model.findOne === 'function') {
    const existing = await model.findOne({ assetId: payload.assetId });
    if (existing) {
      const updates = { ...payload };
      delete updates.createdAt;
      const asset = typeof model.findOneAndUpdate === 'function'
        ? await model.findOneAndUpdate(
            { assetId: payload.assetId },
            { $set: updates },
            { new: true }
          )
        : { ...existing, ...updates };
      return { status: 'updated', asset };
    }

    if (typeof model.create === 'function') {
      const asset = await model.create({ ...payload, createdAt: new Date() });
      return { status: 'created', asset };
    }
  }

  if (typeof model.findOneAndUpdate === 'function') {
    const asset = await model.findOneAndUpdate(
      { assetId: payload.assetId },
      {
        $set: payload,
        $setOnInsert: { createdAt: new Date() },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return { status: 'updated', asset };
  }

  throw new Error('Meme import model does not support create or update');
}

export async function importLocalMemeDirectory(options = {}, deps = {}) {
  const importDir = path.resolve(options.importDir || config.memeImportDir);
  const model = deps.model || MemeAsset;
  const manifest = options.manifest || await readManifest(importDir);
  const files = await collectFiles(importDir);
  const result = {
    importDir,
    created: 0,
    updated: 0,
    skipped: 0,
    assets: [],
  };

  for (const file of files) {
    const ext = path.extname(file.absolutePath).toLowerCase();
    if (!SUPPORTED_MEME_EXTENSIONS.has(ext)) {
      result.skipped += 1;
      continue;
    }

    const bytes = await readFile(file.absolutePath);
    const payload = buildImportPayload({ importDir, file, bytes, manifest });
    const upserted = await upsertMemeAsset(payload, model);
    if (upserted.status === 'created') {
      result.created += 1;
    } else {
      result.updated += 1;
    }
    result.assets.push(upserted.asset);
  }

  return result;
}

async function main() {
  await connectDB();
  try {
    const result = await importLocalMemeDirectory();
    console.log(`meme import completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped from ${result.importDir}`);
  } finally {
    await mongoose.disconnect();
  }
}

const directRunPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (directRunPath && fileURLToPath(import.meta.url) === directRunPath) {
  main().catch((error) => {
    console.error(`meme import failed: ${error.message}`);
    process.exit(1);
  });
}
