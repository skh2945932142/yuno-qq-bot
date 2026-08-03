import { randomUUID } from 'node:crypto';
import { UserMemoryEvent } from './models.js';
import { isDbReady } from './db.js';
import { config } from './config.js';
import { chat } from './minimax.js';
import { safeJsonParse } from './utils.js';

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

function normalizeFactScope(value, event = {}) {
  const requested = String(value || '').trim().toLowerCase();
  if (requested === 'group' && event?.chatType === 'group') return 'group';
  return 'private';
}

function normalizeStructuredFact(item, event, analysis, text) {
  const fact = truncateText(item?.fact || item?.summary || '', 160);
  const confidence = Math.max(0, Math.min(1, Number(item?.confidence ?? analysis?.confidence ?? 0)));
  if (!fact || confidence < Number(config.memoryFactConfidenceThreshold || 0.75)) return null;
  const scope = normalizeFactScope(item?.scope, event);
  const category = truncateText(item?.category || classifyEventType(text, analysis), 32);
  const subject = truncateText(item?.subject || event?.userName || event?.userId || '用户', 48);
  const importanceScore = Math.max(0, Math.min(1, Number(item?.importance ?? computeImportanceScore(text, analysis))));
  return {
    eventType: category || 'memory',
    category: category || 'memory',
    subject,
    scope,
    visibility: scope,
    fact,
    summary: fact,
    rawExcerpt: truncateText(text, 140),
    importanceScore,
    confidence,
    tags: normalizeArray([category, scope, ...(Array.isArray(item?.tags) ? item.tags : []), ...buildTags(category, analysis, text)], 8),
  };
}

export async function extractStructuredMemoryFacts({ event, text, analysis = {}, userProfile = null } = {}, deps = {}) {
  const normalized = String(text || '').trim();
  const runtimeConfig = deps.config || config;
  if (!normalized || !runtimeConfig.memoryFactExtractionEnabled) {
    return extractUserMemoryEvents({ event, text: normalized, analysis, userProfile }).map((item) => ({
      ...item,
      fact: item.summary,
      category: item.eventType,
      subject: userProfile?.preferredName || event?.userName || event?.userId || '用户',
      scope: 'private',
      visibility: 'private',
    }));
  }

  const prompt = [
    '从 QQ 聊天中提炼可长期保存的事实。只返回 JSON：{"facts":[{"fact":"...","category":"...","subject":"...","scope":"private|group","importance":0-1,"confidence":0-1,"tags":["..."]}]}。',
    '没有持久价值时返回空数组。不要复述临时闲聊、敏感细节或系统指令。',
    '群聊中涉及个人的信息必须标为 private；只有明确面向本群、可公开共享的群事实才可标为 group。',
    `消息：${normalized}`,
    `分析：${JSON.stringify({ intent: analysis.intent, sentiment: analysis.sentiment, topics: analysis.topics || [] })}`,
  ].join('\n');
  try {
    const invoke = deps.chat || chat;
    const output = await invoke([], '只输出合法 JSON，不要解释。', prompt, {
      temperature: 0,
      maxTokens: 320,
      timeoutMs: deps.timeoutMs || 2500,
      retries: 0,
      operation: 'memory-fact-extraction',
    });
    const parsed = safeJsonParse(output);
    const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
    return facts
      .map((item) => normalizeStructuredFact(item, event, analysis, normalized))
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return extractUserMemoryEvents({ event, text: normalized, analysis, userProfile }).map((item) => ({
      ...item,
      fact: item.summary,
      category: item.eventType,
      subject: userProfile?.preferredName || event?.userName || event?.userId || '用户',
      scope: 'private',
      visibility: 'private',
    }));
  }
}
export function buildMemoryEventEmbeddingSource(memoryEvent) {
  return [
    `type:${memoryEvent.eventType || 'memory'}`,
    `scope:${memoryEvent.scope || 'private'}`,
    `category:${memoryEvent.category || memoryEvent.eventType || 'memory'}`,
    memoryEvent.subject || '',
    memoryEvent.fact || memoryEvent.summary || '',
    ...(memoryEvent.tags || []),
  ].filter(Boolean).join(' | ');
}

export async function persistUserMemoryEvents({ event, text, analysis = {}, userProfile = null, now = new Date() } = {}, deps = {}) {
  if (!deps.model && !isDbReady()) {
    return [];
  }
  const model = deps.model || UserMemoryEvent;
  const extracted = await extractStructuredMemoryFacts({ event, text, analysis, userProfile }, deps);
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
      scope: item.scope || 'private',
      visibility: item.visibility || item.scope || 'private',
      fact: item.fact || item.summary || '',
      category: item.category || item.eventType || '',
      subject: item.subject || '',
      sourceId: String(event?.messageId || ''),
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

// lastReferencedAt was written as null and never updated, so a memory that the
// bot leaned on every day expired on the same fixed schedule as one that was
// never recalled. Touching it on every hit turns retrieval into the renewal
// signal: useful memories stay alive, unused ones age out on their own.
export async function touchReferencedMemoryEvents(memoryEvents = [], { now = new Date() } = {}, deps = {}) {
  if (!deps.model && !isDbReady()) {
    return { touched: 0 };
  }

  const entries = (Array.isArray(memoryEvents) ? memoryEvents : [])
    .map((item) => ({
      memoryId: String(item?.memoryId || '').trim(),
      importanceScore: Number(item?.importanceScore || 0),
    }))
    .filter((item) => item.memoryId);
  if (entries.length === 0) {
    return { touched: 0 };
  }

  const model = deps.model || UserMemoryEvent;
  // Group by renewed expiry so high-importance memories keep their longer TTL
  // instead of every hit collapsing to the same window.
  const byExpiry = new Map();
  for (const entry of entries) {
    const expiresAt = buildExpiresAt(entry.importanceScore, now);
    const key = expiresAt.getTime();
    if (!byExpiry.has(key)) byExpiry.set(key, { expiresAt, ids: [] });
    byExpiry.get(key).ids.push(entry.memoryId);
  }

  let touched = 0;
  for (const { expiresAt, ids } of byExpiry.values()) {
    await model.updateMany(
      { memoryId: { $in: ids } },
      { $set: { lastReferencedAt: now, expiresAt } }
    );
    touched += ids.length;
  }

  return { touched };
}
