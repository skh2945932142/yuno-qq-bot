import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateGroupTopics,
  buildActivityHistogram,
  buildGroupConversationSummary,
  buildGroupTranscript,
  isConversationEvent,
} from './src/group-summary.js';
import {
  DEFAULT_WINDOW_HOURS,
  WINDOW_MAX_HOURS,
  WINDOW_MIN_HOURS,
  formatWindowLabel,
  parseWindowArgument,
  resolveWindowHours,
} from './src/time-utils.js';
import { buildDailyDigest, buildGroupActivityReport } from './src/group-ops.js';
import { extractTopics } from './src/utils.js';
import { formatToolResultAsYuno } from './src/yuno-formatter.js';
import { parseCommand } from './src/command-parser.js';

const NOW = new Date('2026-08-13T22:00:00+08:00');

function messageEvent(username, summary, minutesAgo, overrides = {}) {
  return {
    groupId: 'g1',
    userId: `u-${username}`,
    username,
    type: 'message',
    summary,
    rawText: summary,
    topics: extractTopics(summary, 8),
    keywordHits: [],
    sentiment: 'neutral',
    anomalyType: '',
    createdAt: new Date(NOW.getTime() - (minutesAgo * 60 * 1000)),
    ...overrides,
  };
}

function sampleEvents() {
  return [
    messageEvent('小明', '有人打算周末去看那个新出的电影吗', 200),
    messageEvent('阿伟', '我想去 但是周六要加班', 195),
    messageEvent('丸子', '周日可以 我下午没事', 190),
    messageEvent('阿伟', '顺便说一下线上那个支付接口今天又超时了', 60),
    messageEvent('小明', '支付接口超时是网关那边的问题 我看了日志', 55),
    messageEvent('阿伟', '那要不要先回滚到上一个版本', 50),
    messageEvent('丸子', '回滚吧 别硬扛', 45),
    messageEvent('小明', '我先建个 issue 把回滚记一下', 40),
  ];
}

test('extractTopics returns words instead of slices cut mid-word', () => {
  // The old implementation chopped any CJK run into greedy 2-6 char pieces, so this
  // sentence became ["顺便说一下线", "上那个支付接", "口今天又超时"].
  const topics = extractTopics('顺便说一下线上那个支付接口今天又超时了', 8);
  assert.deepEqual(topics, ['线上', '支付接口', '超时']);

  assert.deepEqual(extractTopics('超时是网关那边的问题 我看了日志', 8), ['超时', '网关', '问题', '日志']);
  assert.deepEqual(extractTopics('话说你们谁的显卡还没到货', 8), ['显卡', '到货']);
  // Reaction words and bare quantities are not what the group is talking about.
  assert.equal(extractTopics('笑死 我抢了三次都没抢到', 8).includes('笑死'), false);
  assert.equal(extractTopics('笑死 我抢了三次都没抢到', 8).includes('三次'), false);
  // The ascii path still works and stays lowercase.
  const mixed = extractTopics('群里的 docker 容器一启动就退出', 8);
  assert.ok(mixed.includes('docker'));
  assert.ok(mixed.includes('容器'));
});

test('window arguments are parsed with units and clamped to a sane range', () => {
  assert.equal(parseWindowArgument('2h'), 2);
  assert.equal(parseWindowArgument('30m'), 0.5);
  assert.equal(parseWindowArgument('45分钟'), 0.75);
  assert.equal(parseWindowArgument('3d'), 72);
  assert.equal(parseWindowArgument('12小时'), 12);
  assert.equal(parseWindowArgument('90'), 90);

  // Everything unusable falls back instead of reaching the query.
  for (const token of ['abc', '', '  ', null, undefined, '-5', '0']) {
    assert.equal(parseWindowArgument(token, DEFAULT_WINDOW_HOURS), DEFAULT_WINDOW_HOURS, String(token));
  }
  assert.equal(parseWindowArgument('100000'), WINDOW_MAX_HOURS);
  assert.equal(parseWindowArgument('1m'), WINDOW_MIN_HOURS);
  assert.equal(resolveWindowHours(Number.NaN), DEFAULT_WINDOW_HOURS);
  assert.equal(resolveWindowHours(-3), DEFAULT_WINDOW_HOURS);

  assert.equal(formatWindowLabel(24), '24 小时');
  assert.equal(formatWindowLabel(0.5), '30 分钟');
  assert.equal(formatWindowLabel(72), '3 天');
  assert.equal(formatWindowLabel(2), '2 小时');
});

test('/groupreport accepts a window argument with units', () => {
  assert.equal(parseCommand('/groupreport 2h').toolArgs.windowHours, 2);
  assert.equal(parseCommand('/groupreport 30m').toolArgs.windowHours, 0.5);
  assert.equal(parseCommand('/groupreport').toolArgs.windowHours, 24);
  assert.equal(parseCommand('/groupreport 100000').toolArgs.windowHours, WINDOW_MAX_HOURS);
  assert.equal(parseCommand('/leaderboard 2h 3').toolArgs.windowHours, 2);
  assert.equal(parseCommand('/leaderboard 2h 3').toolArgs.limit, 3);
});

test('topics are ranked by how many messages mentioned them, not by recency', () => {
  const topics = aggregateGroupTopics(sampleEvents(), { limit: 5 });
  const names = topics.map((topic) => topic.name);

  assert.ok(names.includes('回滚'), `expected 回滚 in ${names.join(',')}`);
  assert.ok(names.some((name) => name.includes('支付接口')), names.join(','));
  // Every entry used to have count 1, which made the ranking meaningless.
  assert.ok(topics.every((topic) => topic.count >= 2), JSON.stringify(topics));
  assert.ok(topics[0].count >= topics[topics.length - 1].count);
});

test('overlapping topic candidates collapse onto the more frequent label', () => {
  const events = [
    { type: 'message', topics: ['回滚'] },
    { type: 'message', topics: ['回滚'] },
    { type: 'message', topics: ['回滚记'] },
  ];
  const topics = aggregateGroupTopics(events, { limit: 5 });

  // "回滚记" is a bad cut of "回滚"; the frequent form wins the label and takes the count.
  assert.deepEqual(topics, [{ name: '回滚', count: 3 }]);
});

test('a window with no repeated topic still reports its single mentions', () => {
  const topics = aggregateGroupTopics([
    { type: 'message', topics: ['显卡', '到货'] },
  ], { limit: 3 });

  assert.equal(topics.length > 0, true);
  assert.equal(topics.every((topic) => topic.count === 1), true);
});

test('the activity histogram finds the busiest period and scales its buckets', () => {
  const events = [
    messageEvent('小明', '早上说的第一句', 20 * 60),
    messageEvent('阿伟', '晚上第一句', 50),
    messageEvent('丸子', '晚上第二句', 45),
    messageEvent('小明', '晚上第三句', 40),
  ];

  const day = buildActivityHistogram(events, { windowHours: 24, now: NOW, timeZone: 'Asia/Shanghai' });
  assert.equal(day.bucketMinutes, 120);
  assert.equal(day.total, 4);
  assert.equal(day.peak.count, 3);
  assert.equal(day.peak.share, 0.75);
  assert.match(day.peak.label, /^\d{2}:\d{2}-\d{2}:\d{2}$/);

  const hour = buildActivityHistogram(events, { windowHours: 2, now: NOW });
  assert.equal(hour.bucketMinutes, 30);
  assert.equal(hour.total, 3, 'the morning message falls outside a 2h window');

  const empty = buildActivityHistogram([], { windowHours: 24, now: NOW });
  assert.equal(empty.total, 0);
  assert.equal(empty.peak, null);
});

test('the transcript samples across the window instead of only taking the tail', () => {
  const events = Array.from({ length: 40 }, (_, index) => messageEvent('小明', `第 ${index} 句`, 400 - (index * 10)));
  const transcript = buildGroupTranscript(events, { maxLines: 5 });

  assert.equal(transcript.length, 5);
  assert.match(transcript[0], /第 0 句$/, 'the oldest message must survive sampling');
  assert.match(transcript[transcript.length - 1], /第 39 句$/, 'the newest message must survive sampling');
  assert.ok(transcript.every((line) => line.startsWith('小明: ')));
});

test('the transcript drops non-conversation events and respects the character cap', () => {
  const events = [
    messageEvent('小明', '这是一条正常消息', 30),
    { ...messageEvent('新人', '新人 加入了群聊', 20), type: 'notice' },
    { ...messageEvent('阿伟', '阿伟 戳了由乃一下', 10), type: 'poke' },
  ];

  assert.equal(isConversationEvent(events[0]), true);
  assert.equal(isConversationEvent(events[1]), false);
  assert.equal(isConversationEvent(events[2]), false);

  const transcript = buildGroupTranscript(events, { maxLines: 10 });
  assert.deepEqual(transcript, ['小明: 这是一条正常消息']);

  const capped = buildGroupTranscript(
    Array.from({ length: 30 }, (_, index) => messageEvent('小明', `${'很长的一句话'.repeat(6)}${index}`, 30 - index)),
    { maxLines: 30, maxChars: 300 }
  );
  assert.ok(capped.join('\n').length <= 300, `transcript was ${capped.join('\n').length} chars`);
});

test('the conversation summary uses the model when it answers', async () => {
  const calls = [];
  const summary = await buildGroupConversationSummary({
    groupId: 'g1',
    events: sampleEvents(),
    windowHours: 24,
  }, {
    summarizeGroupConversation: async (transcript, context) => {
      calls.push({ lines: transcript.length, context });
      return {
        headline: '主要在忙支付接口。',
        topics: [{ title: '支付接口超时', detail: '最后决定先回滚', participants: ['阿伟', '小明'] }],
      };
    },
  });

  assert.equal(summary.source, 'model');
  assert.equal(summary.headline, '主要在忙支付接口。');
  assert.equal(summary.topics.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.windowHours, 24);
  // Keyword topics are still computed so the caller can show both.
  assert.ok(summary.keywords.length > 0);
});

test('the conversation summary degrades to keywords instead of failing', async () => {
  const events = sampleEvents();

  for (const [label, deps] of [
    ['model returned nothing', { summarizeGroupConversation: async () => null }],
    ['model threw', { summarizeGroupConversation: async () => { throw new Error('model down'); } }],
    ['model returned an empty shape', { summarizeGroupConversation: async () => ({ headline: '', topics: [] }) }],
  ]) {
    const summary = await buildGroupConversationSummary({ groupId: 'g1', events, windowHours: 24 }, deps);
    assert.equal(summary.source, 'keywords', label);
    assert.equal(summary.reason, 'model-unavailable', label);
    assert.ok(summary.keywords.length > 0, label);
    assert.deepEqual(summary.topics, [], label);
  }

  const disabled = await buildGroupConversationSummary({ groupId: 'g1', events, windowHours: 24 }, {
    modelEnabled: false,
    summarizeGroupConversation: async () => {
      throw new Error('must not be called when disabled');
    },
  });
  assert.equal(disabled.source, 'keywords');
  assert.equal(disabled.reason, 'model-disabled');

  const empty = await buildGroupConversationSummary({ groupId: 'g1', events: [], windowHours: 24 }, {});
  assert.equal(empty.source, 'empty');
  assert.equal(empty.reason, 'no-messages');
});

test('the group report separates conversation from notices and clamps the window', async () => {
  const events = [
    ...sampleEvents(),
    { ...messageEvent('新人', '新人 加入了群聊', 30), type: 'notice' },
    { ...messageEvent('阿伟', '阿伟 戳了由乃一下', 25), type: 'poke' },
  ];
  const report = await buildGroupActivityReport('g1', {
    windowHours: 100000,
    now: NOW,
    includeSummary: true,
  }, {
    events,
    summarizeGroupConversation: async () => ({ headline: '在忙支付接口。', topics: [] }),
  });

  assert.equal(report.windowHours, WINDOW_MAX_HOURS, 'an absurd window must be clamped');
  assert.equal(report.windowLabel, '7 天');
  assert.equal(report.totalMessages, 8, 'joins and pokes must not count as messages');
  assert.equal(report.totalEvents, 10);
  assert.equal(report.activeUsers, 3);
  assert.ok(report.peakPeriod?.count > 0);
  assert.equal(report.conversation.source, 'model');
});

test('members who share a display name stay separate leaderboard rows', async () => {
  const events = [
    { ...messageEvent('小明', '第一个小明说话', 30), userId: 'u-1' },
    { ...messageEvent('小明', '第一个小明又说话', 25), userId: 'u-1' },
    { ...messageEvent('小明', '另一个同名的小明', 20), userId: 'u-2' },
  ];
  const report = await buildGroupActivityReport('g1', { windowHours: 24, now: NOW }, { events });

  assert.equal(report.activeUsers, 2);
  assert.equal(report.topUsers.length, 2, JSON.stringify(report.topUsers));
  assert.deepEqual(report.topUsers.map((entry) => entry.count), [2, 1]);
});

test('the report skips the model unless the caller asks for a summary', async () => {
  let called = false;
  const report = await buildGroupActivityReport('g1', { windowHours: 24, now: NOW }, {
    events: sampleEvents(),
    summarizeGroupConversation: async () => {
      called = true;
      return null;
    },
  });

  assert.equal(called, false);
  assert.equal(report.conversation.source, 'skipped');
  assert.ok(report.topTopics.length > 0, 'keyword topics are computed either way');
});

function renderReport(payload, tool = 'group_report') {
  return formatToolResultAsYuno({
    tool,
    payload,
    summary: '',
    visibility: 'group',
    priority: 'normal',
    followUpHint: '',
    safetyFlags: [],
  }, {});
}

test('the rendered report leads with what the group actually talked about', async () => {
  const report = await buildGroupActivityReport('g1', {
    windowHours: 24,
    now: NOW,
    includeSummary: true,
  }, {
    events: sampleEvents(),
    summarizeGroupConversation: async () => ({
      headline: '主要在忙支付接口和周末的安排。',
      topics: [
        { title: '支付接口超时', detail: '阿伟先报的，最后决定先回滚', participants: ['阿伟', '小明'] },
        { title: '周末看电影', detail: '改到了周日', participants: ['小明', '丸子'] },
      ],
    }),
  });
  const text = renderReport(report);

  assert.match(text, /主要在忙支付接口和周末的安排/);
  assert.match(text, /支付接口超时：阿伟先报的，最后决定先回滚（阿伟、小明）/);
  assert.match(text, /周末看电影/);
  assert.match(text, /一共 8 条消息，活跃的有 3 个人/);
  assert.match(text, /最热闹|稍微密一点/);
  assert.doesNotMatch(text, /暂无/);
});

test('the rendered report still names topics when the model is unavailable', async () => {
  const report = await buildGroupActivityReport('g1', {
    windowHours: 24,
    now: NOW,
    includeSummary: true,
  }, {
    events: sampleEvents(),
    summarizeGroupConversation: async () => null,
  });
  const text = renderReport(report);

  assert.match(text, /提得最多的是/);
  assert.match(text, /回滚/);
  assert.match(text, /一共 8 条消息/);
});

test('an empty window says so instead of reporting zero counts', async () => {
  const report = await buildGroupActivityReport('g1', {
    windowHours: 1,
    now: new Date('2026-08-20T22:00:00+08:00'),
    includeSummary: true,
  }, { events: sampleEvents() });

  assert.equal(report.totalMessages, 0);
  const text = renderReport(report);
  assert.match(text, /没什么动静/);
  assert.doesNotMatch(text, /0 条消息/);
});

test('the daily digest carries the same narrative as the report', async () => {
  const digest = await buildDailyDigest('g1', { windowHours: 24, now: NOW }, {
    events: sampleEvents(),
    summarizeGroupConversation: async () => ({
      headline: '今天主要在处理支付接口。',
      topics: [{ title: '支付接口超时', detail: '决定先回滚', participants: ['阿伟'] }],
    }),
  });

  assert.equal(digest.conversation.source, 'model');
  assert.equal(digest.windowLabel, '24 小时');
  assert.ok(digest.peakPeriod);

  const text = renderReport(digest, 'group_daily_digest');
  assert.match(text, /今天的群摘要我收好了/);
  assert.match(text, /今天主要在处理支付接口/);
  assert.match(text, /支付接口超时：决定先回滚（阿伟）/);
});
