import { config } from './config.js';
import { summarizeGroupConversation } from './minimax.js';
import { formatClockInTimeZone, resolveWindowHours } from './time-utils.js';
import { stripCqCodes } from './utils.js';

function asDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function isConversationEvent(event = {}) {
  return String(event.type || 'message') === 'message';
}

// A topic mentioned in one message is a passing remark; a topic is something the
// group came back to. Counting document frequency this way is what fixes the old
// report, where every "topic" had count 1 so the ranking was really just "whatever
// the newest message happened to contain".
export function aggregateGroupTopics(events = [], options = {}) {
  const limit = Math.max(1, Number(options.limit || 5));
  const minMentions = Math.max(1, Number(options.minMentions || 2));
  const counts = new Map();

  for (const event of events) {
    const seen = new Set();
    for (const topic of event.topics || []) {
      const normalized = String(topic || '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  // Fold overlapping candidates together so "回滚" and "回滚记" do not compete for the
  // same slot. The higher-count form becomes the label, because the rarer one is
  // usually a bad cut of the same word; a tie goes to the longer, more specific form.
  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1]
      || right[0].length - left[0].length
      || left[0].localeCompare(right[0]));
  const merged = new Map();
  for (const [name, count] of ranked) {
    let host = '';
    for (const kept of merged.keys()) {
      if (kept.includes(name) || name.includes(kept)) {
        host = kept;
        break;
      }
    }
    if (host) {
      merged.set(host, merged.get(host) + count);
    } else {
      merged.set(name, count);
    }
  }

  const entries = [...merged.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count
      || right.name.length - left.name.length
      || left.name.localeCompare(right.name));
  const repeated = entries.filter((item) => item.count >= minMentions);

  // A short window may legitimately have no repeated topic; showing the most
  // specific single mentions beats showing nothing at all.
  return (repeated.length > 0 ? repeated : entries).slice(0, limit);
}

function bucketMinutesFor(windowHours) {
  if (windowHours <= 3) return 30;
  if (windowHours <= 12) return 60;
  return 120;
}

// dailyMoodTimezone is the only bot-wide timezone setting the project has, so the
// histogram labels reuse it rather than introducing a second source of truth.
function resolveTimeZone(value) {
  return String(value || config.dailyMoodTimezone || 'Asia/Shanghai');
}

export function buildActivityHistogram(events = [], options = {}) {
  const windowHours = resolveWindowHours(options.windowHours);
  const now = asDate(options.now);
  const timeZone = resolveTimeZone(options.timeZone);
  const bucketMinutes = bucketMinutesFor(windowHours);
  const bucketMs = bucketMinutes * 60 * 1000;
  const endMs = now.getTime();
  const startMs = endMs - (windowHours * 60 * 60 * 1000);
  const bucketCount = Math.max(1, Math.ceil((endMs - startMs) / bucketMs));
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(startMs + (index * bucketMs));
    const bucketEnd = new Date(Math.min(endMs, startMs + ((index + 1) * bucketMs)));
    return {
      startAt: bucketStart,
      endAt: bucketEnd,
      label: `${formatClockInTimeZone(bucketStart, timeZone)}-${formatClockInTimeZone(bucketEnd, timeZone)}`,
      count: 0,
    };
  });

  let total = 0;
  for (const event of events) {
    const createdAt = event?.createdAt ? new Date(event.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
    const index = Math.floor((createdAt.getTime() - startMs) / bucketMs);
    if (index < 0 || index >= bucketCount) continue;
    buckets[index].count += 1;
    total += 1;
  }

  const busiest = buckets.reduce(
    (best, bucket) => (bucket.count > best.count ? bucket : best),
    buckets[0]
  );

  return {
    bucketMinutes,
    total,
    buckets,
    peak: total > 0 && busiest.count > 0
      ? {
          label: busiest.label,
          count: busiest.count,
          share: Number((busiest.count / total).toFixed(3)),
        }
      : null,
  };
}

const TRANSCRIPT_LINE_LIMIT = 60;
const TRANSCRIPT_CHAR_LIMIT = 2400;
const TRANSCRIPT_MESSAGE_LIMIT = 120;

// Sampling evenly rather than taking the tail matters for a 24h window: the last 60
// messages can all be from the same evening, which would silently drop the morning.
function sampleEvenly(items, maxCount) {
  if (items.length <= maxCount) return items;
  if (maxCount === 1) return [items[items.length - 1]];
  const step = (items.length - 1) / (maxCount - 1);
  const picked = [];
  for (let index = 0; index < maxCount; index += 1) {
    picked.push(items[Math.round(index * step)]);
  }
  return [...new Set(picked)];
}

export function buildGroupTranscript(events = [], options = {}) {
  const maxLines = Math.max(1, Number(options.maxLines || TRANSCRIPT_LINE_LIMIT));
  const maxChars = Math.max(200, Number(options.maxChars || TRANSCRIPT_CHAR_LIMIT));
  const ordered = events
    .filter(isConversationEvent)
    .filter((event) => String(event.summary || event.rawText || '').trim())
    .slice()
    .sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));

  const lines = [];
  let used = 0;
  for (const event of sampleEvenly(ordered, maxLines)) {
    const speaker = stripCqCodes(String(event.username || event.userId || '群友')).slice(0, 16) || '群友';
    const text = stripCqCodes(String(event.summary || event.rawText || '')).slice(0, TRANSCRIPT_MESSAGE_LIMIT);
    if (!text) continue;
    const line = `${speaker}: ${text}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return lines;
}

/**
 * Produces the narrative half of a group summary. The model output is an enrichment:
 * when it is disabled, times out or returns nothing usable, the caller still gets the
 * deterministic keyword topics along with a reason, matching the project rule that
 * optional infrastructure degrades instead of throwing.
 */
export async function buildGroupConversationSummary(input = {}, deps = {}) {
  const runtimeConfig = deps.config || config;
  const windowHours = resolveWindowHours(input.windowHours);
  const events = Array.isArray(input.events) ? input.events : [];
  const conversationEvents = events.filter(isConversationEvent);
  const keywords = aggregateGroupTopics(conversationEvents, {
    limit: Number(input.topicLimit || 5),
  });
  const base = { headline: '', topics: [], keywords, source: 'keywords', reason: '' };

  if (conversationEvents.length === 0) {
    return { ...base, source: 'empty', reason: 'no-messages' };
  }

  const modelEnabled = deps.modelEnabled
    ?? runtimeConfig.groupSummaryModelEnabled
    ?? true;
  if (!modelEnabled) {
    return { ...base, reason: 'model-disabled' };
  }

  const transcript = buildGroupTranscript(conversationEvents, {
    maxLines: Number(runtimeConfig.groupSummaryMaxTranscriptLines || TRANSCRIPT_LINE_LIMIT),
  });
  if (transcript.length === 0) {
    return { ...base, reason: 'empty-transcript' };
  }

  const result = await (deps.summarizeGroupConversation || summarizeGroupConversation)(
    transcript,
    { groupId: input.groupId, windowHours },
    {
      traceContext: deps.traceContext,
      timeoutMs: Number(runtimeConfig.groupSummaryTimeoutMs || 6000),
      retries: 0,
    }
  ).catch(() => null);

  if (!result || (!result.headline && (result.topics || []).length === 0)) {
    return { ...base, reason: 'model-unavailable' };
  }

  return {
    headline: result.headline || '',
    topics: result.topics || [],
    keywords,
    source: 'model',
    reason: '',
  };
}


