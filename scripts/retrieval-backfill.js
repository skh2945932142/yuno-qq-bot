import { createHash } from 'node:crypto';
import { config } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { syncKnowledgeBase } from '../src/knowledge-base.js';
import { GroupDialogueChunk, MemeAsset, UserMemoryEvent } from '../src/models.js';
import { loadReplyStyleExamples } from '../src/reply-style-retriever.js';
import { indexHybridDocuments, isHybridRetrievalEnabled } from '../src/retrieval-pipeline.js';

function stablePointId(type, sourceId) {
  const hash = createHash('sha256').update(`${type}:${sourceId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function asIso(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
}

async function main() {
  if (!isHybridRetrievalEnabled({ config })) {
    throw new Error('Hybrid retrieval requires RETRIEVAL_HYBRID_ENABLED, RETRIEVAL_GATEWAY_URL, QDRANT_URL, and QDRANT_HYBRID_COLLECTION');
  }

  await connectDB(config);
  try {
    const knowledge = await syncKnowledgeBase({ config });
    const now = new Date();
    const [memories, chunks, memes, styles] = await Promise.all([
      UserMemoryEvent.find({ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
      GroupDialogueChunk.find({ expiresAt: { $gt: now } }),
      MemeAsset.find({ disabled: false }),
      loadReplyStyleExamples(),
    ]);
    const documents = [
      ...memories.map((item) => ({
        id: stablePointId('memory_fact', item.memoryId),
        text: String(item.fact || item.summary || '').trim(),
        payload: {
          type: 'memory_fact', scope: item.scope || 'private', visibility: item.visibility || item.scope || 'private',
          sourceId: item.memoryId, memoryId: item.memoryId, userId: item.userId, chatId: item.chatId, groupId: item.groupId,
          category: item.category || item.eventType, subject: item.subject || '', fact: item.fact || item.summary, summary: item.summary,
          tags: item.tags || [], expiresAt: asIso(item.expiresAt),
        },
      })),
      ...chunks.map((item) => ({
        id: stablePointId('group_dialogue', item.chunkId),
        text: String(item.embeddingSourceText || item.summary || '').trim(),
        payload: {
          type: 'group_dialogue', scope: 'group', visibility: 'group', sourceId: item.chunkId,
          groupId: item.groupId, userId: item.userId, chatId: item.groupId, summary: item.summary, expiresAt: asIso(item.expiresAt),
        },
      })),
      ...memes.map((item) => ({
        id: stablePointId('meme_semantic', item.assetId),
        text: String(item.embeddingSourceText || item.caption || '').trim(),
        payload: {
          type: 'meme_semantic', scope: 'group', visibility: 'group', sourceId: item.assetId,
          chatId: item.chatId, userId: item.userId, caption: item.caption, semanticTags: item.semanticTags || [], expiresAt: asIso(item.expiresAt),
        },
      })),
      ...styles.map((item) => ({
        id: stablePointId('style_example', item.id),
        text: `${item.userText || ''}\n${item.humanReply || ''}`.trim(),
        payload: {
          type: 'style_example', scope: 'global', visibility: 'public', sourceId: item.id,
          scene: item.scene, intent: item.intent, emotion: item.emotion, humanReply: item.humanReply, tags: item.tags || [], quality: item.quality,
        },
      })),
    ].filter((item) => item.text);
    const indexed = await indexHybridDocuments(documents, { config, forceEnabled: true });
    console.log(`hybrid backfill complete: knowledge=${knowledge.count || 0}, auxiliary=${indexed.count || 0}, collection=${config.qdrantHybridCollection}`);
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error(`hybrid backfill failed: ${error.message}`);
  process.exit(1);
});
