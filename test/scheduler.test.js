import test from 'node:test';
import assert from 'node:assert/strict';
import { planScheduledInteraction } from '../src/services/group-state.js';

test('planScheduledInteraction skips when group is already active', () => {
  const now = new Date('2026-03-12T20:00:00+08:00');
  const plan = planScheduledInteraction({
    groupState: {
      mood: 'CALM',
      activityLevel: 80,
      lastMessageAt: new Date(now.getTime() - 20 * 60 * 1000),
      lastProactiveAt: new Date(now.getTime() - 8 * 60 * 60 * 1000),
      recentTopics: ['游戏'],
    },
    recentEvents: [],
    dateContext: now,
  });

  assert.equal(plan.shouldSend, false);
  assert.equal(plan.reason, 'group-already-active');
});

test('planScheduledInteraction creates follow-up topic from recent events', () => {
  const now = new Date('2026-03-12T20:00:00+08:00');
  const plan = planScheduledInteraction({
    groupState: {
      mood: 'CALM',
      activityLevel: 40,
      lastMessageAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      lastProactiveAt: new Date(now.getTime() - 10 * 60 * 60 * 1000),
      recentTopics: ['作业'],
    },
    recentEvents: [{ summary: '阿明在讨论明天的作业' }],
    dateContext: now,
  });

  assert.equal(plan.shouldSend, true);
  assert.equal(plan.topic, 'follow-up');
});
