import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeWhitespace, stripCqCodes, uniqueCompact } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_EXAMPLES_PATH = path.resolve(__dirname, '..', 'data', 'reply-style', 'examples.jsonl');
const exampleCache = new Map();

function normalizeScene(event = {}) {
  return event.chatType === 'private' ? 'private' : 'group';
}

function normalizeIntent({ route, analysis, replyPlan } = {}) {
  const routeCategory = String(route?.category || '').trim();
  const subIntent = String(replyPlan?.interpretation?.subIntent || '').trim();
  if (routeCategory === 'knowledge_qa') return 'knowledge_qa';
  if (routeCategory === 'follow_up') return 'follow_up';
  if (routeCategory === 'poke') return 'poke';
  if (subIntent === '亲近陪伴') return 'social';
  if (replyPlan?.interpretation?.needsEmpathy) return 'help';
  return String(analysis?.intent || routeCategory || 'chat').trim() || 'chat';
}

function normalizeTags(values = []) {
  return uniqueCompact(
    values
      .flatMap((value) => String(value || '').split(/[,\s/]+/))
      .map((value) => value.trim().toLowerCase()),
    10
  );
}

function normalizeQuality(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.75;
  return Math.min(1, Math.max(0, parsed));
}

export function normalizeReplyStyleExample(example = {}) {
  const humanReply = normalizeWhitespace(String(example.humanReply || example.reply || ''));
  if (!humanReply) return null;

  const userText = stripCqCodes(example.userText || example.input || '');
  return {
    id: String(example.id || `${example.scene || 'any'}:${humanReply.slice(0, 16)}`).trim(),
    scene: String(example.scene || 'any').trim().toLowerCase() || 'any',
    intent: String(example.intent || 'chat').trim(),
    emotion: String(example.emotion || '').trim().toUpperCase(),
    userText,
    humanReply,
    tags: normalizeTags(example.tags || []),
    quality: normalizeQuality(example.quality),
  };
}

function parseJsonlExamples(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => normalizeReplyStyleExample(JSON.parse(line)))
    .filter(Boolean);
}

export async function loadReplyStyleExamples(filePath = DEFAULT_EXAMPLES_PATH) {
  const resolvedPath = path.resolve(filePath || DEFAULT_EXAMPLES_PATH);
  if (exampleCache.has(resolvedPath)) {
    return exampleCache.get(resolvedPath);
  }

  try {
    const examples = parseJsonlExamples(await readFile(resolvedPath, 'utf8'));
    exampleCache.set(resolvedPath, examples);
    return examples;
  } catch (error) {
    if (error.code === 'ENOENT') {
      exampleCache.set(resolvedPath, []);
      return [];
    }
    throw error;
  }
}

function tokenize(text) {
  return uniqueCompact(
    (stripCqCodes(text).toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fa5]{2,6}/g) || []),
    12
  );
}

function buildQueryTags({ analysis, replyPlan, userTurn } = {}) {
  const tags = [
    ...(analysis?.ruleSignals || []),
    ...(analysis?.topics || []),
  ];
  const subIntent = String(replyPlan?.interpretation?.subIntent || '');
  if (replyPlan?.interpretation?.needsEmpathy || analysis?.sentiment === 'negative') tags.push('comfort');
  if (/亲近|陪伴/.test(`${subIntent} ${userTurn}`)) tags.push('direct-attention', 'warm');
  if (/梗|抽象|笑死|离谱/.test(`${subIntent} ${userTurn}`)) tags.push('meme');
  if (analysis?.intent === 'help') tags.push('help');
  if (analysis?.sentiment) tags.push(analysis.sentiment);
  return normalizeTags(tags);
}

export function buildReplyStyleQuery({
  event = {},
  route = {},
  analysis = {},
  emotionResult = {},
  replyPlan = null,
  userTurn = '',
} = {}) {
  return {
    scene: normalizeScene(event),
    intent: normalizeIntent({ route, analysis, replyPlan }),
    emotion: String(emotionResult?.emotion || '').trim().toUpperCase(),
    sentiment: String(analysis?.sentiment || '').trim(),
    tags: buildQueryTags({ analysis, replyPlan, userTurn }),
    tokens: tokenize(userTurn),
  };
}

function scoreIntent(exampleIntent, queryIntent) {
  if (exampleIntent === queryIntent) return 4;
  const comfortLike = new Set(['help', 'comfort', 'empathic_followup']);
  if (comfortLike.has(exampleIntent) && comfortLike.has(queryIntent)) return 2.5;
  if (exampleIntent === 'chat' && !['knowledge_qa', 'poke'].includes(queryIntent)) return 1;
  return 0;
}

export function scoreReplyStyleExample(example, query) {
  let score = 0;
  if (example.scene === query.scene) score += 4;
  else if (example.scene === 'any') score += 1;

  score += scoreIntent(example.intent, query.intent);

  if (example.emotion && example.emotion === query.emotion) score += 1.5;
  if (query.sentiment === 'negative' && example.tags.includes('comfort')) score += 1.25;
  if (query.tags.length > 0) {
    const overlap = example.tags.filter((tag) => query.tags.includes(tag)).length;
    score += Math.min(3, overlap * 0.75);
  }

  if (query.tokens.length > 0) {
    const exampleTokens = new Set(tokenize(`${example.userText} ${example.humanReply}`));
    const tokenOverlap = query.tokens.filter((token) => exampleTokens.has(token)).length;
    score += Math.min(2, tokenOverlap * 0.4);
  }

  return Number((score * (0.75 + example.quality * 0.25)).toFixed(4));
}

function resolveLimit(replyLengthProfile = {}, explicitLimit = null) {
  if (Number.isFinite(Number(explicitLimit)) && Number(explicitLimit) > 0) {
    return Math.round(Number(explicitLimit));
  }
  return replyLengthProfile?.promptProfile === 'fast' ? 1 : 3;
}

export async function retrieveReplyStyleExamples({
  event = {},
  route = {},
  analysis = {},
  emotionResult = {},
  replyPlan = null,
  userTurn = '',
  replyLengthProfile = {},
  limit = null,
} = {}, deps = {}) {
  const sourceExamples = Array.isArray(deps.examples)
    ? deps.examples
    : await (deps.loadReplyStyleExamples || loadReplyStyleExamples)(deps.filePath || DEFAULT_EXAMPLES_PATH);
  const examples = sourceExamples.map(normalizeReplyStyleExample).filter(Boolean);
  if (examples.length === 0) return [];

  const query = buildReplyStyleQuery({
    event,
    route,
    analysis,
    emotionResult,
    replyPlan,
    userTurn,
  });
  const resolvedLimit = resolveLimit(replyLengthProfile, limit);

  return examples
    .map((example) => ({
      ...example,
      score: scoreReplyStyleExample(example, query),
    }))
    .sort((left, right) => right.score - left.score || right.quality - left.quality)
    .slice(0, resolvedLimit);
}
