import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';
import { GroupEvent } from './models.js';
import { extractTopics, inferSentiment, stripCqCodes, uniqueCompact } from './utils.js';
import {
  getRecentEvents,
  recordGroupEvent,
  updateGroupStateFromAnalysis,
} from './state/group-state.js';

const DEFAULT_KEYWORD_TOPICS = [
  'deploy',
  'bug',
  'error',
  '报警',
  '更新',
  '上线',
  '作业',
  '考试',
  '值班',
];

function asDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeSummary(text, fallback = '') {
  const normalized = stripCqCodes(text).slice(0, 120).trim();
  return normalized || fallback;
}

function buildFallbackSummary(event) {
  if (event.source?.noticeType === 'group_increase') {
    return `${event.userName || event.userId} 加入了群聊`;
  }

  if (event.rawText === '[poke]' || event.text === '/poke') {
    return `${event.userName || event.userId} 戳了由乃一下`;
  }

  if ((event.attachments || []).some((item) => item.type === 'image')) {
    return `${event.userName || event.userId} 发来了一张图片`;
  }

  if ((event.attachments || []).some((item) => item.type === 'face')) {
    return `${event.userName || event.userId} 发来了一张表情`;
  }

  if ((event.attachments || []).length > 0) {
    return `${event.userName || event.userId} 发来了一条消息`;
  }

  return `${event.userName || event.userId} 在群里说了话`;
}

function findKeywordHits(text, keywords = DEFAULT_KEYWORD_TOPICS) {
  const normalized = stripCqCodes(text).toLowerCase();
  if (!normalized) {
    return [];
  }

  const hits = [];
  for (const keyword of keywords) {
    const candidate = String(keyword || '').trim().toLowerCase();
    if (!candidate || hits.includes(candidate)) {
      continue;
    }
    if (normalized.includes(candidate)) {
      hits.push(candidate);
    }
  }
  return hits;
}

function detectAnomaly(summary, recentEvents = []) {
  if (!summary) {
    return '';
  }

  const normalized = summary.toLowerCase();
  const repeatedCount = recentEvents.filter((event) => String(event.summary || '').toLowerCase() === normalized).length;
  if (repeatedCount >= 2) {
    return 'repeat';
  }

  if (summary.length >= 80) {
    return 'long-message';
  }

  return '';
}

function rankEntries(map, limit = 5) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function filterEventsByWindow(events, windowHours = 24, now = new Date()) {
  const threshold = asDate(now).getTime() - (windowHours * 60 * 60 * 1000);
  return events.filter((event) => asDate(event.createdAt).getTime() >= threshold);
}

function buildLeaderboardFromEvents(events, limit = 5) {
  const counts = new Map();
  for (const event of events) {
    const key = String(event.userId || event.username || '').trim();
    if (!key) {
      continue;
    }
    const label = String(event.username || event.userId || '').trim();
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return rankEntries(counts, limit);
}

function buildTopicRanking(events, limit = 5) {
  const counts = new Map();
  for (const event of events) {
    for (const topic of event.topics || []) {
      const normalized = String(topic || '').trim();
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return rankEntries(counts, limit);
}

export async function recordInboundGroupObservation(event, deps = {}) {
  if (!event || event.chatType !== 'group' || !event.chatId) {
    return null;
  }

  const recentEvents = await (deps.getRecentEvents || getRecentEvents)(event.chatId, 6);
  const rawText = String(event.rawText || event.text || '');
  const summary = event.source?.noticeType === 'group_increase' || rawText === '[poke]'
    ? buildFallbackSummary(event)
    : normalizeSummary(rawText, buildFallbackSummary(event));
  const topics = uniqueCompact(extractTopics(summary), 5);
  const keywordHits = findKeywordHits(summary, deps.keywords || DEFAULT_KEYWORD_TOPICS);
  const sentiment = inferSentiment(summary);
  const anomalyType = detectAnomaly(summary, recentEvents);
  const createdAt = asDate(event.timestamp);

  const saved = await (deps.recordGroupEvent || recordGroupEvent)({
    groupId: event.chatId,
    userId: event.userId,
    username: event.userName,
    type: event.source?.noticeType === 'group_increase' ? 'notice' : (event.rawText === '[poke]' ? 'poke' : 'message'),
    eventSource: event.source?.noticeType || event.source?.postType || 'message',
    messageId: event.messageId || '',
    rawText: summary,
    summary,
    sentiment,
    topics,
    keywordHits,
    anomalyType,
    createdAt,
  });

  await (deps.updateGroupStateFromAnalysis || updateGroupStateFromAnalysis)({
    groupId: event.chatId,
    analysis: {
      sentiment,
      confidence: keywordHits.length > 0 || anomalyType ? 0.75 : 0.45,
      topics,
    },
    summary,
    now: createdAt,
  });

  recordWorkflowMetric('yuno_group_observations_total', 1, {
    group_id: String(event.chatId),
    event_type: saved?.type || 'message',
  });

  if (anomalyType) {
    recordWorkflowMetric('yuno_group_anomalies_total', 1, {
      group_id: String(event.chatId),
      anomaly: anomalyType,
    });
  }

  return saved;
}

export async function getGroupEventsForWindow(groupId, options = {}, deps = {}) {
  const windowHours = Number(options.windowHours || 24);
  const now = asDate(options.now);
  const limit = Number(options.limit || 500);

  if (deps.events) {
    return filterEventsByWindow(deps.events, windowHours, now).slice(0, limit);
  }

  const query = {
    groupId: String(groupId),
    createdAt: { $gte: new Date(now.getTime() - (windowHours * 60 * 60 * 1000)) },
  };

  const model = deps.GroupEvent || GroupEvent;
  return model.find(query).sort({ createdAt: -1 }).limit(limit);
}

export async function buildGroupActivityReport(groupId, options = {}, deps = {}) {
  const windowHours = Number(options.windowHours || 24);
  const now = asDate(options.now);
  const events = await getGroupEventsForWindow(groupId, { windowHours, now, limit: options.limit || 500 }, deps);
  const leaderboard = buildLeaderboardFromEvents(events, Number(options.topUsers || 5));
  const topTopics = buildTopicRanking(events, Number(options.topTopics || 5));
  const anomalyEvents = events.filter((event) => event.anomalyType);
  const activeUsers = new Set(events.map((event) => String(event.userId || '').trim()).filter(Boolean)).size;

  const report = {
    groupId: String(groupId),
    windowHours,
    totalMessages: events.length,
    activeUsers,
    topUsers: leaderboard,
    topTopics,
    anomalies: anomalyEvents.slice(0, 5).map((event) => ({
      type: event.anomalyType,
      summary: event.summary,
      createdAt: event.createdAt,
    })),
    lastEventAt: events[0]?.createdAt || null,
  };

  recordWorkflowMetric('yuno_group_reports_generated_total', 1, {
    group_id: String(groupId),
    window_hours: String(windowHours),
  });

  return report;
}

export async function buildActivityLeaderboard(groupId, options = {}, deps = {}) {
  const windowHours = Number(options.windowHours || 24);
  const limit = Number(options.limit || 5);
  const now = asDate(options.now);
  const events = await getGroupEventsForWindow(groupId, { windowHours, now, limit: options.fetchLimit || 500 }, deps);
  return {
    groupId: String(groupId),
    windowHours,
    leaders: buildLeaderboardFromEvents(events, limit),
  };
}

export async function buildDailyDigest(groupId, options = {}, deps = {}) {
  const report = await buildGroupActivityReport(groupId, {
    windowHours: Number(options.windowHours || 24),
    now: options.now,
    topUsers: 3,
    topTopics: 3,
  }, deps);

  return {
    groupId: report.groupId,
    totalMessages: report.totalMessages,
    activeUsers: report.activeUsers,
    topUsers: report.topUsers,
    topTopics: report.topTopics,
    anomalies: report.anomalies,
    summary: `最近 ${report.windowHours} 小时里一共 ${report.totalMessages} 条消息，活跃了 ${report.activeUsers} 个人。`,
  };
}

export function buildGroupObservationSummary(event, observation = {}) {
  const pieces = [
    `${event.userName || event.userId}`,
    observation.anomalyType ? `触发了 ${observation.anomalyType}` : '刚刚发言',
  ];
  if (observation.keywordHits?.length) {
    pieces.push(`关键词=${observation.keywordHits.join('/')}`);
  }
  return pieces.join(' ');
}

export function logGroupOps(category, message, meta = {}) {
  logger.info(category, message, meta);
}
