import { randomUUID } from 'node:crypto';
import { UserMemoryEvent } from './models.js';
import { isDbReady } from './db.js';

const MEMORY_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const HIGH_IMPORTANCE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

function truncateText(text, limit = 120) {
  const normalized = String(text || '').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function normalizeArray(items, limit = 6) {
  const values = [];
  for (const item of items || []) {
    const normalized = String(item || '').trim();
    if (!normalized || values.includes(normalized)) continue;
    values.push(normalized);
    if (values.length >= limit) break;
  }
  return values;
}

function buildExpiresAt(importanceScore, now = new Date()) {
  const ttlMs = importanceScore >= 0.88 ? HIGH_IMPORTANCE_TTL_MS : MEMORY_EVENT_TTL_MS;
  return new Date(now.getTime() + ttlMs);
}

function classifyEventType(text, analysis = {}) {
  const normalized = String(text || '');
  if (/(约定|答应我|别忘了|promise|记住这件事)/i.test(normalized)) {
    return 'promise';
  }
  if (/(笑死|蚌埠住了|以后提到|这就是那个梗|老样子)/i.test(normalized)) {
    return 'inside_joke';
  }
  if (/(考试|面试|答辩|毕业|生日|搬家|出差|旅行|住院|手术|比赛|发版)/i.test(normalized)) {
    return 'milestone';
  }
  if (analysis.sentiment === 'negative' || /(焦虑|难受|崩溃|委屈|紧张|失眠|害怕|沮丧)/i.test(normalized)) {
    return 'emotion';
  }
  return 'preference';
}

function computeImportanceScore(text, analysis = {}) {
  const normalized = String(text || '');
  let score = Number(analysis.relevance || 0.45);
  if (/(约定|答应我|别忘了|记住这件事)/i.test(normalized)) score += 0.35;
  if (/(考试|面试|答辩|生日|住院|手术|分手|毕业)/i.test(normalized)) score += 0.25;
  if (analysis.sentiment === 'negative') score += 0.1;
  if (analysis.intent === 'help') score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function buildTags(eventType, analysis = {}, text = '') {
  const tags = [eventType];
  if (analysis.intent) tags.push(`intent:${analysis.intent}`);
  if (analysis.sentiment) tags.push(`sentiment:${analysis.sentiment}`);
  if (/(考试|面试|答辩)/i.test(text)) tags.push('study');
  if (/(生日|旅行|比赛)/i.test(text)) tags.push('life-event');
  if (/(约定|答应我|别忘了)/i.test(text)) tags.push('promise');
  return normalizeArray(tags, 8);
}

export function extractUserMemoryEvents({ event, text, analysis = {}, userProfile = null } = {}) {
  const normalized = String(text || '').trim();
  if (!normalized || normalized.length < 4) {
    return [];
  }

  const eventType = classifyEventType(normalized, analysis);
  const importanceScore = computeImportanceScore(normalized, analysis);
  const confidence = Math.max(0.4, Math.min(1, Number(analysis.confidence || 0.65)));
  const explicitEvent = /(记住|别忘了|约定|答应我|考试|面试|答辩|生日|住院|手术|焦虑|难受|崩溃|以后提到)/i.test(normalized);
  if (!explicitEvent && importanceScore < 0.72) {
    return [];
  }

  const summaryPrefix = userProfile?.preferredName
    ? `${userProfile.preferredName}提到`
    : `${event?.userName || '用户'}提到`;
  const summary = truncateText(`${summaryPrefix}${normalized}`, 96);
  const rawExcerpt = truncateText(normalized, 140);

  return [{
    eventType,
    summary,
    rawExcerpt,
    importanceScore,
    confidence,
    tags: buildTags(eventType, analysis, normalized),
  }];
}

export function buildMemoryEventEmbeddingSource(memoryEvent) {
  return [
    `type:${memoryEvent.eventType || 'memory'}`,
    memoryEvent.summary || '',
    memoryEvent.rawExcerpt || '',
    ...(memoryEvent.tags || []),
  ].filter(Boolean).join(' | ');
}

export async function persistUserMemoryEvents({ event, text, analysis = {}, userProfile = null, now = new Date() } = {}, deps = {}) {
  if (!deps.model && !isDbReady()) {
    return [];
  }
  const model = deps.model || UserMemoryEvent;
  const extracted = extractUserMemoryEvents({ event, text, analysis, userProfile });
  if (!extracted.length) {
    return [];
  }

  const created = [];
  for (const item of extracted) {
    const payload = {
      memoryId: randomUUID(),
      platform: event?.platform || 'qq',
      userId: String(event?.userId || ''),
      chatId: String(event?.chatId || ''),
      groupId: String(event?.chatType === 'group' ? event?.chatId || '' : ''),
      eventType: item.eventType,
      summary: item.summary,
      rawExcerpt: item.rawExcerpt,
      tags: item.tags,
      importanceScore: item.importanceScore,
      confidence: item.confidence,
      sourceMessageIds: [String(event?.messageId || '')].filter(Boolean),
      embeddingSourceText: buildMemoryEventEmbeddingSource(item),
      lastReferencedAt: null,
      createdAt: now,
      expiresAt: buildExpiresAt(item.importanceScore, now),
    };
    created.push(await model.create(payload));
  }
  return created;
}

export async function listActiveUserMemoryEvents({ userId, limit = 4, now = new Date() } = {}, deps = {}) {
  if (!deps.model && !isDbReady()) {
    return [];
  }
  const model = deps.model || UserMemoryEvent;
  return model.find({
    userId: String(userId || ''),
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: now } },
    ],
  }).sort({ importanceScore: -1, createdAt: -1 }).limit(limit);
}
