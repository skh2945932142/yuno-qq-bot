import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordParticipationReply,
  resetParticipationState,
  resolveAmbientJoinDecision,
  resolveParticipationDecision,
} from './src/participation-policy.js';

const BASE_CONFIG = {
  participationSkipProbability: 0.12,
  participationReactionProbability: 0.18,
  participationMaxConsecutiveReplies: 2,
  ambientJoinEnabled: true,
  ambientJoinProbability: 0.02,
  ambientJoinCooldownMs: 600000,
  ambientJoinMaxPerDay: 6,
  targetGroupId: '20001',
};

function groupEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'group',
    chatId: '20001',
    userId: '30001',
    messageId: 'g-1',
    rawText: '今天这个方案我看还行，明天再确认一次',
    text: '今天这个方案我看还行，明天再确认一次',
    attachments: [],
    mentionsBot: false,
    source: { postType: 'message' },
    ...overrides,
  };
}

test('explicit summons are never silenced', () => {
  resetParticipationState();
  const always = [
    { event: { ...groupEvent(), mentionsBot: true }, analysis: { relevance: 0.1, ruleSignals: ['direct-mention'] } },
    { event: groupEvent({ rawText: '/help', text: '/help' }), analysis: { relevance: 0.1, ruleSignals: [] } },
    { event: groupEvent({ source: { postType: 'notice', subType: 'poke' } }), analysis: { reason: 'poke-trigger', relevance: 0.2 } },
    { event: groupEvent(), analysis: { reason: 'basic-direct-mention-pass', relevance: 0.2 } },
  ];

  for (const input of always) {
    const decision = resolveParticipationDecision({
      ...input,
      runtimeConfig: BASE_CONFIG,
      random: () => 0,
    });
    assert.equal(decision.mode, 'reply');
    assert.equal(decision.reason, 'explicit-trigger');
  }
});

test('private chat with real content always gets a full reply', () => {
  resetParticipationState();
  const decision = resolveParticipationDecision({
    event: { ...groupEvent(), chatType: 'private', chatId: '10001' },
    analysis: { relevance: 0 },
    runtimeConfig: BASE_CONFIG,
    random: () => 0,
  });

  // Private chat is no longer reported as an explicit summons: the reason now
  // distinguishes "answered because it is private" from "answered because the
  // user summoned the bot", which the participation metric can separate.
  assert.deepEqual(decision, { mode: 'reply', reason: 'private-default-reply' });
});

test('private chat neither rate-limits consecutive replies nor samples them away', () => {
  resetParticipationState();
  const event = { ...groupEvent(), chatType: 'private', chatId: '10001' };
  const now = Date.now();

  for (let index = 0; index < 6; index += 1) {
    recordParticipationReply(event, now);
  }

  const decision = resolveParticipationDecision({
    event,
    analysis: { relevance: 0 },
    runtimeConfig: BASE_CONFIG,
    now,
    // A random draw of 0 would trigger both the reaction branch and the
    // low-relevance sampling branch in group chat.
    random: () => 0,
  });

  assert.deepEqual(decision, { mode: 'reply', reason: 'private-default-reply' });
});

test('private chat downgrades content-free messages to a reaction or silence', () => {
  resetParticipationState();
  const privateEvent = (text) => ({
    ...groupEvent(),
    chatType: 'private',
    chatId: '10001',
    rawText: text,
    text,
  });

  for (const text of ['嗯', '。', '🤔', '？？']) {
    const reaction = resolveParticipationDecision({
      event: privateEvent(text),
      analysis: { relevance: 0.4 },
      runtimeConfig: BASE_CONFIG,
      random: () => 0,
    });
    const skip = resolveParticipationDecision({
      event: privateEvent(text),
      analysis: { relevance: 0.4 },
      runtimeConfig: BASE_CONFIG,
      random: () => 0.9,
    });

    assert.deepEqual(reaction, { mode: 'reaction', reason: 'low-information-inbound' }, text);
    assert.deepEqual(skip, { mode: 'skip', reason: 'low-information-inbound' }, text);
  }
});

test('private chat still answers short commands and pokes', () => {
  resetParticipationState();
  const command = resolveParticipationDecision({
    event: { ...groupEvent(), chatType: 'private', chatId: '10001', rawText: '/help', text: '/help' },
    analysis: { relevance: 0 },
    runtimeConfig: BASE_CONFIG,
    random: () => 0.9,
  });
  const poke = resolveParticipationDecision({
    event: {
      ...groupEvent(),
      chatType: 'private',
      chatId: '10001',
      rawText: '/poke',
      text: '/poke',
      source: { postType: 'notice', subType: 'poke' },
    },
    analysis: { reason: 'poke-trigger', relevance: 0 },
    runtimeConfig: BASE_CONFIG,
    random: () => 0.9,
  });

  assert.equal(command.mode, 'reply');
  assert.equal(poke.mode, 'reply');
});

test('low information inbound becomes a reaction or a silent skip', () => {
  resetParticipationState();
  const event = groupEvent({ rawText: '？？', text: '？？' });
  const reaction = resolveParticipationDecision({
    event,
    analysis: { relevance: 0.4, ruleSignals: ['keyword'] },
    runtimeConfig: BASE_CONFIG,
    random: () => 0,
  });
  const skip = resolveParticipationDecision({
    event,
    analysis: { relevance: 0.4, ruleSignals: ['keyword'] },
    runtimeConfig: BASE_CONFIG,
    random: () => 0.9,
  });

  assert.deepEqual(reaction, { mode: 'reaction', reason: 'low-information-inbound' });
  assert.deepEqual(skip, { mode: 'skip', reason: 'low-information-inbound' });

  const emojiOnly = resolveParticipationDecision({
    event: groupEvent({ rawText: '🤔🤔', text: '🤔🤔' }),
    analysis: { relevance: 0.4, ruleSignals: ['keyword'] },
    runtimeConfig: BASE_CONFIG,
    random: () => 0,
  });
  assert.equal(emojiOnly.mode, 'reaction');
});

test('low relevance keyword hits are sampled into silence', () => {
  resetParticipationState();
  const input = {
    event: groupEvent(),
    analysis: { relevance: 0.3, ruleSignals: ['keyword'] },
    runtimeConfig: BASE_CONFIG,
  };

  assert.deepEqual(
    resolveParticipationDecision({ ...input, random: () => 0.05 }),
    { mode: 'skip', reason: 'low-relevance-sampling' }
  );
  assert.deepEqual(
    resolveParticipationDecision({ ...input, random: () => 0.9 }),
    { mode: 'reply', reason: 'default-reply' }
  );
  assert.deepEqual(
    resolveParticipationDecision({
      event: groupEvent(),
      analysis: { relevance: 0.8, ruleSignals: ['keyword'] },
      runtimeConfig: BASE_CONFIG,
      random: () => 0.05,
    }),
    { mode: 'reply', reason: 'default-reply' }
  );
});

test('consecutive replies to the same user are downgraded and recover after the window', () => {
  resetParticipationState();
  const event = groupEvent();
  const analysis = { relevance: 0.9, ruleSignals: ['keyword'] };
  const now = 1_700_000_000_000;

  assert.equal(
    resolveParticipationDecision({ event, analysis, runtimeConfig: BASE_CONFIG, now, random: () => 0.9 }).mode,
    'reply'
  );
  recordParticipationReply(event, now);
  recordParticipationReply(event, now + 1000);

  const limited = resolveParticipationDecision({
    event,
    analysis,
    runtimeConfig: BASE_CONFIG,
    now: now + 2000,
    random: () => 0.9,
  });
  assert.deepEqual(limited, { mode: 'skip', reason: 'consecutive-reply-limit' });

  const reacted = resolveParticipationDecision({
    event,
    analysis,
    runtimeConfig: BASE_CONFIG,
    now: now + 2000,
    random: () => 0,
  });
  assert.deepEqual(reacted, { mode: 'reaction', reason: 'consecutive-reply-limit' });

  const afterWindow = resolveParticipationDecision({
    event,
    analysis,
    runtimeConfig: BASE_CONFIG,
    now: now + 120000,
    random: () => 0.9,
  });
  assert.equal(afterWindow.mode, 'reply');

  // an explicit @ in the same streak still wins
  const mentioned = resolveParticipationDecision({
    event: { ...event, mentionsBot: true },
    analysis,
    runtimeConfig: BASE_CONFIG,
    now: now + 2000,
    random: () => 0.9,
  });
  assert.equal(mentioned.mode, 'reply');
});

test('ambient join respects probability, target group, activity, cooldown and daily cap', () => {
  resetParticipationState();
  const groupState = { activityLevel: 60 };
  const now = 1_700_000_000_000;

  assert.deepEqual(
    resolveAmbientJoinDecision({
      event: groupEvent(),
      groupState,
      runtimeConfig: BASE_CONFIG,
      now,
      random: () => 0.9,
    }),
    { allowed: false, reason: 'ambient-not-sampled' }
  );

  const allowed = resolveAmbientJoinDecision({
    event: groupEvent(),
    groupState,
    runtimeConfig: BASE_CONFIG,
    now,
    random: () => 0,
  });
  assert.deepEqual(allowed, { allowed: true, reason: 'ambient-join' });

  const cooled = resolveAmbientJoinDecision({
    event: groupEvent({ messageId: 'g-2' }),
    groupState,
    runtimeConfig: BASE_CONFIG,
    now: now + 1000,
    random: () => 0,
  });
  assert.deepEqual(cooled, { allowed: false, reason: 'ambient-cooldown' });

  assert.deepEqual(
    resolveAmbientJoinDecision({
      event: groupEvent({ chatId: '99999' }),
      groupState,
      runtimeConfig: BASE_CONFIG,
      now,
      random: () => 0,
    }),
    { allowed: false, reason: 'not-target-group' }
  );
  assert.deepEqual(
    resolveAmbientJoinDecision({
      event: { ...groupEvent(), chatType: 'private' },
      groupState,
      runtimeConfig: BASE_CONFIG,
      now,
      random: () => 0,
    }),
    { allowed: false, reason: 'not-group' }
  );
  assert.deepEqual(
    resolveAmbientJoinDecision({
      event: groupEvent(),
      groupState: { activityLevel: 3 },
      runtimeConfig: BASE_CONFIG,
      now,
      random: () => 0,
    }),
    { allowed: false, reason: 'group-idle' }
  );
  assert.deepEqual(
    resolveAmbientJoinDecision({
      event: groupEvent(),
      groupState,
      runtimeConfig: { ...BASE_CONFIG, ambientJoinEnabled: false },
      now,
      random: () => 0,
    }),
    { allowed: false, reason: 'ambient-disabled' }
  );
});

test('ambient join stops at the configured daily maximum', () => {
  resetParticipationState();
  const groupState = { activityLevel: 60 };
  const runtimeConfig = { ...BASE_CONFIG, ambientJoinCooldownMs: 0, ambientJoinMaxPerDay: 2 };
  const now = 1_700_000_000_000;

  for (let index = 0; index < 2; index += 1) {
    const decision = resolveAmbientJoinDecision({
      event: groupEvent({ messageId: `g-${index}` }),
      groupState,
      runtimeConfig,
      now: now + index * 1000,
      random: () => 0,
    });
    assert.equal(decision.allowed, true);
  }

  const blocked = resolveAmbientJoinDecision({
    event: groupEvent({ messageId: 'g-blocked' }),
    groupState,
    runtimeConfig,
    now: now + 5000,
    random: () => 0,
  });
  assert.deepEqual(blocked, { allowed: false, reason: 'ambient-daily-limit' });

  const nextDay = resolveAmbientJoinDecision({
    event: groupEvent({ messageId: 'g-next-day' }),
    groupState,
    runtimeConfig,
    now: now + 30 * 60 * 60 * 1000,
    random: () => 0,
  });
  assert.equal(nextDay.allowed, true);
});


test('ambient join is disabled by default so the bot never speaks first', () => {
  resetParticipationState();
  const decision = resolveAmbientJoinDecision({
    event: groupEvent({ messageId: 'g-default' }),
    groupState: { activityLevel: 80 },
    now: 1_700_000_000_000,
    random: () => 0,
  });

  assert.deepEqual(decision, { allowed: false, reason: 'ambient-disabled' });
});
