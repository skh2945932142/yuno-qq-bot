import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivityLeaderboard,
  buildDailyDigest,
  buildGroupActivityReport,
  recordInboundGroupObservation,
} from './src/group-ops.js';

const now = new Date('2026-03-27T12:00:00+08:00');

function createEvents() {
  return [
    {
      groupId: 'g1',
      userId: 'u1',
      username: 'Alice',
      summary: 'deploy finished',
      topics: ['deploy'],
      anomalyType: '',
      createdAt: new Date('2026-03-27T11:50:00+08:00'),
    },
    {
      groupId: 'g1',
      userId: 'u2',
      username: 'Bob',
      summary: 'deploy failed once',
      topics: ['deploy', 'bug'],
      anomalyType: 'repeat',
      createdAt: new Date('2026-03-27T11:40:00+08:00'),
    },
    {
      groupId: 'g1',
      userId: 'u1',
      username: 'Alice',
      summary: 'bug fixed',
      topics: ['bug'],
      anomalyType: '',
      createdAt: new Date('2026-03-27T11:30:00+08:00'),
    },
  ];
}

test('buildGroupActivityReport summarizes recent group traffic', async () => {
  const report = await buildGroupActivityReport('g1', { windowHours: 2, now }, {
    events: createEvents(),
  });

  assert.equal(report.totalMessages, 3);
  assert.equal(report.activeUsers, 2);
  assert.equal(report.topUsers[0].name, 'Alice');
  assert.equal(report.topTopics[0].name, 'deploy');
  assert.equal(report.anomalies.length, 1);
});

test('buildActivityLeaderboard ranks users by message count', async () => {
  const leaderboard = await buildActivityLeaderboard('g1', { windowHours: 2, now, limit: 2 }, {
    events: createEvents(),
  });

  assert.equal(leaderboard.leaders.length, 2);
  assert.equal(leaderboard.leaders[0].name, 'Alice');
  assert.equal(leaderboard.leaders[0].count, 2);
});

test('buildDailyDigest returns compact digest payload', async () => {
  const digest = await buildDailyDigest('g1', { now }, {
    events: createEvents(),
  });

  assert.match(digest.summary, /3 条消息/);
  assert.equal(digest.topUsers.length, 2);
});

test('recordInboundGroupObservation extracts keyword hits and repeat anomaly', async () => {
  const recorded = [];
  const stateUpdates = [];
  const recentEvents = [{ summary: 'deploy issue' }, { summary: 'deploy issue' }];

  const result = await recordInboundGroupObservation({
    platform: 'qq',
    chatType: 'group',
    chatId: 'g1',
    userId: 'u1',
    userName: 'Alice',
    messageId: 'm1',
    rawText: 'deploy issue',
    text: 'deploy issue',
    timestamp: now.getTime(),
    source: { postType: 'message' },
    attachments: [],
  }, {
    getRecentEvents: async () => recentEvents,
    recordGroupEvent: async (payload) => {
      recorded.push(payload);
      return payload;
    },
    updateGroupStateFromAnalysis: async (payload) => {
      stateUpdates.push(payload);
      return payload;
    },
  });

  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0].keywordHits, ['deploy']);
  assert.equal(recorded[0].anomalyType, 'repeat');
  assert.equal(stateUpdates.length, 1);
  assert.equal(result.summary, 'deploy issue');
});


test('recordInboundGroupObservation covers notice, poke, attachments, long messages, and invalid events', async () => {
  assert.equal(await recordInboundGroupObservation(null, {}), null);
  const recorded = [];
  const deps = {
    getRecentEvents: async () => [],
    recordGroupEvent: async (payload) => { recorded.push(payload); return payload; },
    updateGroupStateFromAnalysis: async () => null,
    keywords: ['', 'deploy', 'deploy'],
  };
  const base = {
    platform: 'qq', chatType: 'group', chatId: 'g2', userId: 'u2', userName: 'Bob',
    messageId: '', timestamp: now.getTime(), source: { postType: 'message' }, attachments: [],
  };
  await recordInboundGroupObservation({ ...base, rawText: '', source: { noticeType: 'group_increase' } }, deps);
  await recordInboundGroupObservation({ ...base, rawText: '[poke]' }, deps);
  await recordInboundGroupObservation({ ...base, rawText: '', attachments: [{ type: 'image' }] }, deps);
  await recordInboundGroupObservation({ ...base, rawText: '', attachments: [{ type: 'face' }] }, deps);
  await recordInboundGroupObservation({ ...base, rawText: '', attachments: [{ type: 'file' }] }, deps);
  await recordInboundGroupObservation({ ...base, rawText: 'x'.repeat(90) }, deps);
  assert.match(recorded[0].summary, /加入/);
  assert.equal(recorded[1].type, 'poke');
  assert.match(recorded[2].summary, /图片/);
  assert.match(recorded[3].summary, /表情/);
  assert.match(recorded[4].summary, /消息/);
  assert.equal(recorded[5].anomalyType, 'long-message');
});

test('group event window covers model query and empty report branches', async () => {
  const calls = [];
  const model = {
    find(query) {
      calls.push(query);
      return {
        sort(order) { calls.push(order); return this; },
        async limit(limit) { calls.push(limit); return []; },
      };
    },
  };
  const { getGroupEventsForWindow, buildGroupObservationSummary } = await import('./src/group-ops.js');
  const events = await getGroupEventsForWindow('g-model', { windowHours: 1, now, limit: 2 }, { GroupEvent: model });
  assert.deepEqual(events, []);
  const report = await buildGroupActivityReport('g-empty', { windowHours: 1, now }, { events: [] });
  assert.equal(report.totalMessages, 0);
  assert.equal(report.lastEventAt, null);
  assert.equal(buildGroupObservationSummary({ userName: 'A' }, { anomalyType: 'repeat', keywordHits: ['deploy'] }), 'A 触发了 repeat 关键词=deploy');
  assert.equal(buildGroupObservationSummary({ userId: 'u1' }), 'u1 刚刚发言');
});
