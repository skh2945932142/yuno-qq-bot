import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from './src/config.js';
import { GroupEvent, GroupState } from './src/models.js';
import {
  canUseAdvancedGroupFeatures,
  ensureGroupState,
  getRecentEvents,
  markProactiveSent,
  planScheduledInteraction,
  recordGroupEvent,
  updateGroupStateFromAnalysis,
} from './src/state/group-state.js';

test('legacy group state caches reads and records bounded events without a database', async () => {
  const originalStateUpdate = GroupState.findOneAndUpdate;
  const originalFind = GroupEvent.find;
  const originalCreate = GroupEvent.create;
  const originalFindOne = GroupEvent.findOne;
  const originalDeleteMany = GroupEvent.deleteMany;
  const stateCalls = [];
  const deleted = [];
  try {
    GroupState.findOneAndUpdate = async (...args) => {
      stateCalls.push(args);
      return { groupId: args[0].groupId, mood: 'CALM', moodIntensity: 0.4, activityLevel: 10, recentTopics: [] };
    };
    GroupEvent.find = () => ({
      sort() { return this; },
      async limit(limit) { return [{ summary: `latest:${limit}` }]; },
    });
    GroupEvent.create = async (payload) => ({ _id: 'event-1', ...payload });
    GroupEvent.findOne = () => ({
      sort() { return this; },
      skip() { return this; },
      async select() { return { _id: 'cutoff', createdAt: new Date('2026-07-20T00:00:00Z') }; },
    });
    GroupEvent.deleteMany = async (filter) => {
      deleted.push(filter);
      return { deletedCount: 2 };
    };

    const first = await ensureGroupState('legacy-cache-group');
    const second = await ensureGroupState('legacy-cache-group');
    assert.equal(first, second);
    assert.equal(stateCalls.length, 1);

    const events = await getRecentEvents('legacy-events-group', 3);
    assert.deepEqual(events, [{ summary: 'latest:3' }]);
    assert.equal(await getRecentEvents('legacy-events-group', 3), events);

    assert.equal(await recordGroupEvent({ groupId: 'g', summary: '' }), null);
    const recorded = await recordGroupEvent({
      groupId: 'g', userId: 'u', username: 'Alice', summary: 'summary', sentiment: 'neutral', topics: ['one'],
    });
    assert.equal(recorded._id, 'event-1');
    assert.equal(deleted.length, 1);
  } finally {
    GroupState.findOneAndUpdate = originalStateUpdate;
    GroupEvent.find = originalFind;
    GroupEvent.create = originalCreate;
    GroupEvent.findOne = originalFindOne;
    GroupEvent.deleteMany = originalDeleteMany;
  }
});

test('legacy group state updates mood, activity, topics, and proactive timestamp', async () => {
  const originalStateUpdate = GroupState.findOneAndUpdate;
  const calls = [];
  try {
    GroupState.findOneAndUpdate = async (_filter, update) => {
      calls.push(update);
      if (calls.length === 1) {
        return {
          groupId: 'legacy-update-group', mood: 'CALM', moodIntensity: 0.5, activityLevel: 20,
          recentTopics: ['old', 'duplicate'], lastActiveWindowAt: null, lastInteractionSummary: 'old summary',
        };
      }
      return { groupId: 'legacy-update-group', ...update };
    };

    const now = new Date('2026-07-23T10:00:00Z');
    const updated = await updateGroupStateFromAnalysis({
      groupId: 'legacy-update-group',
      analysis: { sentiment: 'positive', confidence: 0.9, topics: ['new', 'duplicate'] },
      summary: 'a sufficiently active summary for the group',
      now,
    });
    assert.equal(updated.groupId, 'legacy-update-group');
    assert.equal(calls[1].mood, 'AFFECTIONATE');
    assert.deepEqual(calls[1].recentTopics, ['new', 'duplicate', 'old']);

    await markProactiveSent('legacy-proactive-group', now);
    assert.deepEqual(calls.at(-1), { lastProactiveAt: now });
  } finally {
    GroupState.findOneAndUpdate = originalStateUpdate;
  }
});

test('legacy scheduled interaction covers missing, cooldown, active, morning, and night branches', () => {
  const base = {
    activityLevel: 10,
    recentTopics: ['topic'],
    lastMessageAt: new Date('2026-07-22T00:00:00Z'),
    lastProactiveAt: new Date('2026-07-22T00:00:00Z'),
  };
  assert.equal(planScheduledInteraction({ groupState: null, recentEvents: [] }).reason, 'missing-group-state');
  assert.equal(planScheduledInteraction({
    groupState: base, recentEvents: [], dateContext: new Date('2026-07-23T12:00:00'),
  }).reason, 'unsupported-time-slot');
  assert.equal(planScheduledInteraction({
    groupState: { ...base, lastProactiveAt: new Date('2026-07-23T06:30:00') },
    recentEvents: [], dateContext: new Date('2026-07-23T07:00:00'),
  }).reason, 'recent-proactive');
  assert.equal(planScheduledInteraction({
    groupState: { ...base, activityLevel: 70, lastMessageAt: new Date('2026-07-23T06:50:00') },
    recentEvents: [], dateContext: new Date('2026-07-23T07:00:00'),
  }).reason, 'morning-group-already-active');
  assert.equal(planScheduledInteraction({
    groupState: { ...base, activityLevel: 60, lastMessageAt: new Date('2026-07-23T22:50:00') },
    recentEvents: [], dateContext: new Date('2026-07-23T23:00:00'),
  }).reason, 'night-group-still-active');
  assert.equal(planScheduledInteraction({
    groupState: base, recentEvents: [{ summary: 'recent event' }], dateContext: new Date('2026-07-23T07:00:00'),
  }).slot, 'morning');
  assert.equal(planScheduledInteraction({
    groupState: base, recentEvents: [{ summary: 'recent event' }], dateContext: new Date('2026-07-23T23:00:00'),
  }).slot, 'night');
});

test('legacy advanced group feature follows configured target group', () => {
  assert.equal(canUseAdvancedGroupFeatures('target-group'), false);
  assert.equal(canUseAdvancedGroupFeatures(''), false);
});
