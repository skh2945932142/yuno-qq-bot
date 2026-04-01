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

