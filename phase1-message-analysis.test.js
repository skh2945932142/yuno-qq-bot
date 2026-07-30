import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrigger, analyzeTriggerFast, isBotTargetedPokeEvent, isNonTargetPokeEvent } from './src/message-analysis.js';

test('analyzeTrigger defaults to replying in private chat', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    userName: 'Alice',
    rawText: 'what can you do?',
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: null,
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'private-default-reply');
});

test('analyzeTrigger suppresses group chatter without explicit trigger', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '10001',
    userName: 'Alice',
    rawText: 'what should we eat today',
    mentionsBot: false,
  }, {
    relation: { affection: 30, activeScore: 10 },
    groupState: { activityLevel: 10 },
  });

  assert.equal(result.shouldRespond, false);
  assert.equal(result.reason, 'explicit-trigger-required');
});

test('special user trigger keywords count as explicit group triggers', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '20001',
    userName: 'Scathach',
    rawText: '师父，教导我',
    mentionsBot: false,
  }, {
    relation: { affection: 88, activeScore: 72 },
    userProfile: { bondMemories: ['约定'], specialNicknames: ['师父'] },
    groupState: { activityLevel: 20 },
    specialUser: {
      userId: '20001',
      label: 'Scathach',
      affectionFloor: 88,
      triggerKeywords: ['教导我', '师父'],
      memorySeeds: ['约定'],
    },
  }, {
    triggerPolicy: {
      keywords: [],
    },
  });

  assert.equal(result.shouldRespond, true);
  assert.equal(result.reason, 'special-keyword-trigger');
  assert.match(result.ruleSignals.join(','), /special-user/);
  assert.match(result.ruleSignals.join(','), /special-keyword/);
});

test('jealousy topics are detected for special users', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'private',
    chatId: 'u1',
    userId: '20001',
    userName: 'Scathach',
    rawText: '你别看别人了',
  }, {
    relation: { affection: 90, activeScore: 80 },
    groupState: null,
    specialUser: {
      userId: '20001',
      label: 'Scathach',
      affectionFloor: 88,
      triggerKeywords: ['教导我'],
      memorySeeds: [],
    },
  });

  assert.equal(result.shouldRespond, true);
  assert.match(result.ruleSignals.join(','), /jealousy-topic/);
});

test('leaving and cold-shoulder language can trigger low-frequency jealousy context', async () => {
  const result = await analyzeTrigger({
    platform: 'qq',
    chatType: 'private',
    chatId: 'u1',
    userId: '20001',
    userName: 'Scathach',
    rawText: '我先走了，晚点可能不回你',
  }, {
    relation: { affection: 90, activeScore: 80 },
    groupState: null,
    specialUser: {
      userId: '20001',
      label: 'Scathach',
      affectionFloor: 88,
      triggerKeywords: [],
      memorySeeds: [],
    },
  });

  assert.equal(result.shouldRespond, true);
  assert.match(result.ruleSignals.join(','), /jealousy-topic/);
});


test('fast trigger analysis distinguishes targeted and non-targeted group poke events', () => {
  const targeted = {
    platform: 'qq', chatType: 'group', chatId: 'g', userId: 'u', rawText: '/poke', text: '/poke',
    mentionsBot: true, source: { postType: 'notice', noticeType: 'notify', subType: 'poke' }, selfId: '10000',
  };
  const nonTargeted = { ...targeted, mentionsBot: false };
  assert.equal(isBotTargetedPokeEvent(targeted), true);
  assert.equal(isNonTargetPokeEvent(nonTargeted), true);
  assert.equal(analyzeTriggerFast(targeted).shouldRespond, true);
  assert.equal(analyzeTriggerFast(nonTargeted).reason, 'non-target-poke');
});
const AMBIENT_CONFIG = {
  ambientJoinEnabled: true,
  ambientJoinProbability: 0.02,
  ambientJoinCooldownMs: 600000,
  ambientJoinMaxPerDay: 6,
  targetGroupId: '12345',
};

function ambientGroupEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'group',
    chatId: '12345',
    userId: '10001',
    userName: 'Alice',
    messageId: 'ambient-1',
    rawText: '这个排期我觉得还得再压一压',
    text: '这个排期我觉得还得再压一压',
    mentionsBot: false,
    source: { postType: 'message' },
    ...overrides,
  };
}

test('ambient join can answer untriggered group chatter in the target group', async () => {
  const { resetParticipationState } = await import('./src/participation-policy.js');
  resetParticipationState();

  const allowed = await analyzeTrigger(ambientGroupEvent(), {
    relation: { affection: 40, activeScore: 20 },
    groupState: { activityLevel: 60 },
  }, {
    runtimeConfig: AMBIENT_CONFIG,
    ambientRandom: () => 0,
  });

  assert.equal(allowed.shouldRespond, true);
  assert.equal(allowed.reason, 'ambient-join');
  assert.equal(allowed.relevance, 0.45);
  assert.match(allowed.ruleSignals.join(','), /ambient-join/);

  resetParticipationState();
  const denied = await analyzeTrigger(ambientGroupEvent({ messageId: 'ambient-2' }), {
    relation: { affection: 40, activeScore: 20 },
    groupState: { activityLevel: 60 },
  }, {
    runtimeConfig: AMBIENT_CONFIG,
    ambientRandom: () => 0.99,
  });

  assert.equal(denied.shouldRespond, false);
  assert.equal(denied.reason, 'explicit-trigger-required');
});

test('fast trigger analysis shares the same ambient join gate', async () => {
  const { resetParticipationState } = await import('./src/participation-policy.js');
  resetParticipationState();

  const allowed = analyzeTriggerFast(ambientGroupEvent({ messageId: 'ambient-fast-1' }), {
    runtimeConfig: AMBIENT_CONFIG,
    groupState: { activityLevel: 60 },
    ambientRandom: () => 0,
  });
  assert.equal(allowed.shouldRespond, true);
  assert.equal(allowed.reason, 'ambient-join');

  resetParticipationState();
  const idle = analyzeTriggerFast(ambientGroupEvent({ messageId: 'ambient-fast-2' }), {
    runtimeConfig: AMBIENT_CONFIG,
    groupState: { activityLevel: 2 },
    ambientRandom: () => 0,
  });
  assert.equal(idle.shouldRespond, false);
  assert.equal(idle.reason, 'explicit-trigger-required');

  resetParticipationState();
  const otherGroup = analyzeTriggerFast(ambientGroupEvent({ chatId: '99999', messageId: 'ambient-fast-3' }), {
    runtimeConfig: AMBIENT_CONFIG,
    groupState: { activityLevel: 60 },
    ambientRandom: () => 0,
  });
  assert.equal(otherGroup.shouldRespond, false);
  assert.equal(otherGroup.reason, 'explicit-trigger-required');
});
