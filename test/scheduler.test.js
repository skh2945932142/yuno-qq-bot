import test from 'node:test';
import assert from 'node:assert/strict';
import { planScheduledInteraction } from '../src/state/group-state.js';

test('planScheduledInteraction skips unsupported time slots', () => {
  const now = new Date('2026-03-12T20:00:00+08:00');
  const plan = planScheduledInteraction({
    groupState: {
      mood: 'CALM',
      activityLevel: 20,
      lastMessageAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      lastProactiveAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
      recentTopics: ['上课'],
    },
    recentEvents: [],
    dateContext: now,
  });

  assert.equal(plan.shouldSend, false);
  assert.equal(plan.reason, 'unsupported-time-slot');
});

test('planScheduledInteraction creates a morning wake-up reminder', () => {
  const now = new Date('2026-03-13T07:00:00+08:00');
  const plan = planScheduledInteraction({
    groupState: {
      mood: 'CALM',
      activityLevel: 25,
      lastMessageAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      lastProactiveAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
      recentTopics: ['早八', '作业'],
    },
    recentEvents: [{ summary: '阿明昨晚还在吐槽早八' }],
    dateContext: now,
  });

  assert.equal(plan.shouldSend, true);
  assert.equal(plan.slot, 'morning');
  assert.equal(plan.topic, 'wake-up');
  assert.match(plan.textHint, /早八/);
});

test('planScheduledInteraction creates a bedtime reminder', () => {
  const now = new Date('2026-03-13T23:00:00+08:00');
  const plan = planScheduledInteraction({
    groupState: {
      mood: 'CALM',
      activityLevel: 20,
      lastMessageAt: new Date(now.getTime() - 90 * 60 * 1000),
      lastProactiveAt: new Date(now.getTime() - 14 * 60 * 60 * 1000),
      recentTopics: ['实验报告'],
    },
    recentEvents: [{ summary: '有人还在改实验报告' }],
    dateContext: now,
  });

  assert.equal(plan.shouldSend, true);
  assert.equal(plan.slot, 'night');
  assert.equal(plan.topic, 'sleep-reminder');
  assert.match(plan.textHint, /实验报告/);
});

test('planScheduledInteraction skips morning reminder when group is already active', () => {
  const now = new Date('2026-03-13T07:00:00+08:00');
  const plan = planScheduledInteraction({
    groupState: {
      mood: 'CALM',
      activityLevel: 70,
      lastMessageAt: new Date(now.getTime() - 10 * 60 * 1000),
      lastProactiveAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
      recentTopics: ['上课'],
    },
    recentEvents: [],
    dateContext: now,
  });

  assert.equal(plan.shouldSend, false);
  assert.equal(plan.reason, 'morning-group-already-active');
});
