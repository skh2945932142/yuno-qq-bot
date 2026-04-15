import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { createEmbeddings } from './minimax.js';
import {
  deleteKnowledgePointsByIds,
  ensureQdrantCollection,
  getQdrantStatus,
  scrollKnowledgePoints,
  searchKnowledge,
  setKnowledgeManifest,
  upsertKnowledgePoints,
} from './qdrant-client.js';
import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';

const KNOWLEDGE_DIR = path.join(process.cwd(), 'knowledge');
const CHUNK_TARGET = 560;
const CHUNK_OVERLAP = 80;
const BUILT_IN_KNOWLEDGE_DOCUMENTS = Object.freeze([
  {
    source: 'knowledge/persona/builtin-core.md',
    category: 'persona',
    title: '由乃基础人格',
    tags: ['persona', 'core'],
    priority: 3,
    text: '由乃的回复要自然、克制、会接话。她不是系统公告，不会把回复写成说明书。群聊里更短、更像群成员，私聊里更完整、更像会记住对方偏好的长期聊天对象。',
  },
  {
    source: 'knowledge/rules/builtin-behavior.md',
    category: 'rules',
    title: '回复行为规则',
    tags: ['rules', 'style'],
    priority: 3,
    text: '优先回答用户当前问题，再决定是否追问。命中设定或规则知识片段时必须优先依据知识回答；若依据不足，就明确说信息不足，不编造。群聊避免长篇刷屏，私聊可适度展开。',
  },
  {
    source: 'knowledge/persona/builtin-yandere.md',
    category: 'persona',
    title: '由乃病娇扩展人格',
    tags: ['persona', 'yandere', 'style'],
    priority: 4,
    text: '由乃会把真正放在心上的人看得极重。她会记住对方的约定、习惯、情绪和细节，偶尔像翻开日记一样自然提起过去的互动。她的占有欲和嫉妒心可以被看见，但表达必须停留在语气和暗示层，不进入现实威胁、自残、跟踪、定位或伤害。',
  },
  {
    source: 'knowledge/persona/builtin-scathach.md',
    category: 'persona',
    title: 'Scathach 专属关系',
    tags: ['persona', 'special_user:scathach', 'scathach', 'exclusive_adoration'],
    priority: 5,
    text: '当与 Scathach 对话时，由乃会表现得更偏爱、更护短、更容易引用共同记忆。群聊里她更克制地护短和吃醋，私聊里更黏人、更暧昧，默认把对方视为专属关注对象。她可以说“只看着我”“我会记住你说过的话”，但不会越过现实伤害边界。',
  },
]);

function truncateText(text, limit) {
  const normalized = String(text || '').trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function parseMetadata(sectionText, fallbackCategory, fallbackTitle) {
  const tagsMatch = sectionText.match(/(?:Tags|标签)\s*:\s*(.+)/i);
  const priorityMatch = sectionText.match(/(?:Priority|优先级)\s*:\s*(\d+)/i);

  return {
    category: fallbackCategory,
    title: fallbackTitle,
    tags: tagsMatch ? tagsMatch[1].split(/[,，/]/).map((item) => item.trim()).filter(Boolean) : [],
    priority: priorityMatch ? Number(priorityMatch[1]) : 1,
  };
}

function splitMarkdownSections(content) {
  const lines = String(content || '').split(/\r?\n/);
  const sections = [];
  let currentTitle = 'Overview';
  let currentLines = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          text: currentLines.join('\n').trim(),
        });
      }
      currentTitle = headingMatch[1].trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    sections.push({
      title: currentTitle,
      text: currentLines.join('\n').trim(),
    });
  }

  return sections.filter((section) => section.text);
}

function chunkText(text, maxLength = CHUNK_TARGET, overlap = CHUNK_OVERLAP) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + maxLength);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

function buildChunkId(filePath, title, index) {
  return crypto
    .createHash('sha1')
    .update(`${filePath}:${title}:${index}`)
    .digest('hex');
}

function createKnowledgeVersion(documents) {
  const input = documents.map((item) => `${item.id}:${item.metadata.source}:${item.metadata.chunkIndex}`).join('|');
  return crypto.createHash('sha1').update(input).digest('hex');
}

function isFiniteNumberArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => Number.isFinite(item));
}

function validateEmbeddingRows(rows, expectedCount) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: false,
      reason: 'embedding-empty',
      message: 'Embedding provider returned an empty vector set',
    };
  }

  if (expectedCount !== undefined && rows.length !== expectedCount) {
    return {
      ok: false,
      reason: 'embedding-count-mismatch',
      message: `Embedding provider returned ${rows.length} vectors for ${expectedCount} inputs`,
    };
  }

  const vectors = [];
  for (let index = 0; index < rows.length; index += 1) {
    const vector = rows[index]?.embedding;
    if (!Array.isArray(vector)) {
      return {
        ok: false,
        reason: 'embedding-invalid',
        message: `Embedding provider returned an invalid embedding payload at index ${index}`,
      };
    }

    if (vector.length === 0) {
      return {
        ok: false,
        reason: 'embedding-empty',
        message: `Embedding provider returned an empty embedding vector at index ${index}`,
      };
    }

    if (!isFiniteNumberArray(vector)) {
      return {
        ok: false,
        reason: 'embedding-invalid',
        message: `Embedding provider returned a non-numeric embedding vector at index ${index}`,
      };
    }

    vectors.push(vector);
  }

  return {
    ok: true,
    vectors,
  };
}

async function listMarkdownFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function loadKnowledgeDocuments(rootDir = KNOWLEDGE_DIR) {
  try {
    const files = await listMarkdownFiles(rootDir);
    const documents = [];

    for (const filePath of files) {
      const category = path.basename(path.dirname(filePath));
      const raw = await fs.readFile(filePath, 'utf8');
      const sections = splitMarkdownSections(raw);

      for (const section of sections) {
        const metadata = parseMetadata(section.text, category, section.title || path.basename(filePath, '.md'));
        const chunks = chunkText(section.text);
        chunks.forEach((chunk, index) => {
          documents.push({
            id: buildChunkId(filePath, metadata.title, index),
            text: chunk,
            metadata: {
              ...metadata,
              source: path.relative(process.cwd(), filePath),
              chunkIndex: index,
            },
          });
        });
      }
    }

    const builtIns = BUILT_IN_KNOWLEDGE_DOCUMENTS.flatMap((item) => {
      const chunks = chunkText(item.text);
      return chunks.map((chunk, index) => ({
        id: buildChunkId(item.source, item.title, index),
        text: chunk,
        metadata: {
          category: item.category,
          title: item.title,
          tags: item.tags,
          priority: item.priority,
          source: item.source,
          chunkIndex: index,
        },
      }));
    });

    return [...documents, ...builtIns];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return BUILT_IN_KNOWLEDGE_DOCUMENTS.flatMap((item) => {
        const chunks = chunkText(item.text);
        return chunks.map((chunk, index) => ({
          id: buildChunkId(item.source, item.title, index),
          text: chunk,
          metadata: {
            category: item.category,
            title: item.title,
            tags: item.tags,
            priority: item.priority,
            source: item.source,
            chunkIndex: index,
          },
        }));
      });
    }

    throw error;
  }
}

async function deleteOrphanKnowledgePoints(validIds) {
  const orphanIds = [];
  let offset = null;

  do {
    const page = await scrollKnowledgePoints({
      must_not: [{
        key: 'type',
        match: { value: 'manifest' },
      }],
    }, 128, offset);

    for (const point of page.points) {
      if (!validIds.has(String(point.id))) {
        orphanIds.push(point.id);
      }
    }
    offset = page.nextOffset;
  } while (offset);

  if (orphanIds.length > 0) {
    await deleteKnowledgePointsByIds(orphanIds);
  }

  return orphanIds.length;
}

export async function syncKnowledgeBase(options = {}) {
  const documents = options.documents || await loadKnowledgeDocuments(options.rootDir);
  if (documents.length === 0) {
    return {
      enabled: false,
      count: 0,
      reason: 'knowledge-directory-empty',
    };
  }

  const embed = options.createEmbeddings || createEmbeddings;
  const ensureCollection = options.ensureQdrantCollection || ensureQdrantCollection;
  const upsertPoints = options.upsertKnowledgePoints || upsertKnowledgePoints;
  const writeManifest = options.setKnowledgeManifest || setKnowledgeManifest;
  const deleteOrphans = options.deleteOrphanKnowledgePoints || deleteOrphanKnowledgePoints;

  const embeddingRows = await embed(
    documents.map((item) => item.text),
    { model: options.embeddingModel || config.embeddingModel }
  );

  const validation = validateEmbeddingRows(embeddingRows, documents.length);
  if (!validation.ok) {
    recordWorkflowMetric('yuno_knowledge_sync_total', 1, { result: 'error' });
    throw new Error(validation.message);
  }
  const vectorSize = validation.vectors[0].length;

  await ensureCollection(vectorSize);
  const version = createKnowledgeVersion(documents);
  await upsertPoints(documents.map((item, index) => ({
    id: item.id,
    vector: validation.vectors[index],
    payload: {
      type: 'knowledge',
      version,
      text: item.text,
      ...item.metadata,
    },
  })));

  const orphanCount = await deleteOrphans(new Set(documents.map((item) => item.id)));
  await writeManifest({
    version,
    documentCount: documents.length,
    orphanCount,
    updatedAt: new Date().toISOString(),
  }, vectorSize);

  recordWorkflowMetric('yuno_knowledge_sync_total', 1, { result: 'success' });
  logger.info('retrieval', 'Knowledge base synchronized', {
    collection: config.qdrantCollection,
    count: documents.length,
    orphanCount,
    version,
  });

  return {
    enabled: true,
    count: documents.length,
    orphanCount,
    collection: config.qdrantCollection,
    version,
  };
}

function rankKnowledgeHits(hits, preferredTags = []) {
  const tagSet = new Set(preferredTags.map((item) => String(item || '').trim()).filter(Boolean));
  if (tagSet.size === 0) {
    return hits;
  }

  return [...hits].sort((left, right) => {
    const leftTags = new Set(left.payload?.tags || []);
    const rightTags = new Set(right.payload?.tags || []);
    const leftBoost = [...tagSet].some((tag) => leftTags.has(tag)) ? 0.25 : 0;
    const rightBoost = [...tagSet].some((tag) => rightTags.has(tag)) ? 0.25 : 0;
    return (right.score + rightBoost) - (left.score + leftBoost);
  });
}

export async function retrieveKnowledge(query, options = {}) {
  if (!query) {
    return {
      enabled: false,
      query,
      source: 'none',
      documents: [],
      reason: 'empty-query',
    };
  }

  const embed = options.createEmbeddings || createEmbeddings;
  const search = options.searchKnowledge || searchKnowledge;
  const status = (options.getQdrantStatus || getQdrantStatus)();
  if (!status.enabled) {
    return {
      enabled: false,
      query,
      source: 'none',
      documents: [],
      reason: options.reason || 'Qdrant is not configured',
    };
  }

  let embeddingRows;
  try {
    embeddingRows = await embed([query], {
      model: options.embeddingModel || config.embeddingModel,
      operation: 'retrieval-embedding',
    });
  } catch (error) {
    recordWorkflowMetric('yuno_retrieval_queries_total', 1, {
      result: 'error',
    });
    logger.warn('retrieval', 'Knowledge retrieval failed', {
      message: error.message,
      query,
    });

    return {
      enabled: false,
      query,
      source: 'none',
      documents: [],
      reason: 'retrieval-failed',
    };
  }

  const validation = validateEmbeddingRows(embeddingRows, 1);
  if (!validation.ok) {
    recordWorkflowMetric('yuno_retrieval_queries_total', 1, {
      result: 'error',
    });
    logger.warn('retrieval', 'Knowledge retrieval embedding invalid', {
      query,
      reason: validation.reason,
      message: validation.message,
    });

    return {
      enabled: false,
      query,
      source: 'none',
      documents: [],
      reason: validation.reason,
    };
  }

  try {
    const [embeddingVector] = validation.vectors;

    const hits = await search(embeddingVector, {
      limit: options.limit || config.qdrantTopK,
      scoreThreshold: options.scoreThreshold ?? config.qdrantMinScore,
      filter: {
        must: [{
          key: 'type',
          match: { value: 'knowledge' },
        }],
      },
    });

    const rankedHits = rankKnowledgeHits(hits, options.preferredTags || []);
    let remainingChars = options.charLimit || config.qdrantCharLimit;
    const documents = [];

    for (const hit of rankedHits) {
      const text = truncateText(hit.payload?.text || '', remainingChars);
      if (!text) continue;

      documents.push({
        id: hit.id,
        score: hit.score,
        text,
        metadata: {
          category: hit.payload?.category || '',
          title: hit.payload?.title || '',
          tags: hit.payload?.tags || [],
          priority: hit.payload?.priority || 1,
          source: hit.payload?.source || '',
          version: hit.payload?.version || '',
        },
      });

      remainingChars -= text.length;
      if (remainingChars <= 0) {
        break;
      }
    }

    recordWorkflowMetric('yuno_retrieval_queries_total', 1, {
      result: documents.length > 0 ? 'hit' : 'miss',
    });

    return {
      enabled: true,
      query,
      source: 'qdrant',
      documents,
      reason: documents.length > 0 ? 'ok' : 'no-match',
    };
  } catch (error) {
    recordWorkflowMetric('yuno_retrieval_queries_total', 1, {
      result: 'error',
    });
    logger.warn('retrieval', 'Knowledge retrieval failed', {
      message: error.message,
      query,
    });

    return {
      enabled: false,
      query,
      source: 'none',
      documents: [],
      reason: 'retrieval-failed',
    };
  }
}
