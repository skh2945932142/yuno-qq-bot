import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { createEmbeddings } from './minimax.js';
import { getQdrantStatus, ensureQdrantCollection, searchKnowledge, upsertKnowledgePoints } from './qdrant-client.js';

const KNOWLEDGE_DIR = path.join(process.cwd(), 'knowledge');
const CHUNK_TARGET = 560;
const CHUNK_OVERLAP = 80;
const RETRIEVAL_CHAR_LIMIT = 1200;

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
    tags: tagsMatch ? tagsMatch[1].split(/[,，]/).map((item) => item.trim()).filter(Boolean) : [],
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

      sections.forEach((section) => {
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
      });
    }

    return documents;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
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

  const embeddingRows = await createEmbeddings(
    documents.map((item) => item.text),
    { model: options.embeddingModel || config.embeddingModel }
  );

  const vectorSize = embeddingRows[0]?.embedding?.length;
  if (!vectorSize) {
    throw new Error('Embedding provider returned an empty vector set');
  }

  await ensureQdrantCollection(vectorSize);
  await upsertKnowledgePoints(documents.map((item, index) => ({
    id: item.id,
    vector: embeddingRows[index].embedding,
    payload: {
      text: item.text,
      ...item.metadata,
    },
  })));

  return {
    enabled: true,
    count: documents.length,
    collection: config.qdrantCollection,
  };
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

  const status = getQdrantStatus();
  if (!status.enabled) {
    return {
      enabled: false,
      query,
      source: 'none',
      documents: [],
      reason: options.reason || 'Qdrant is not configured',
    };
  }

  try {
    const [embedding] = await createEmbeddings([query], {
      model: options.embeddingModel || config.embeddingModel,
      operation: 'retrieval-embedding',
    });

    const hits = await searchKnowledge(embedding.embedding, {
      limit: options.limit || 4,
      scoreThreshold: options.scoreThreshold,
    });

    let remainingChars = options.charLimit || RETRIEVAL_CHAR_LIMIT;
    const documents = [];

    for (const hit of hits) {
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
        },
      });

      remainingChars -= text.length;
      if (remainingChars <= 0) {
        break;
      }
    }

    return {
      enabled: true,
      query,
      source: 'qdrant',
      documents,
      reason: documents.length > 0 ? 'ok' : 'no-match',
    };
  } catch (error) {
    return {
      enabled: false,
      query,
      source: 'none',
      documents: [],
      reason: error.message || 'retrieval-failed',
    };
  }
}
