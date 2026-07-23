import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrigger, analyzeTriggerFast } from './src/message-analysis.js';

function groupEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'group',
    chatId: 'group-coverage',
    userId: 'user-coverage',
    userName: 'Tester',
    rawText: '普通消息',
    text: '普通消息',
    mentionsBot: false,
    attachments: [],
    source: { postType: 'message', messageType: 'group' },
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    relation: { affection: 10, activeScore: 10 },
    userProfile: null,
    conversationState: { rollingSummary: 'recent context' },
    groupState: { activityLevel: 10 },
    topics: ['test-topic'],
    ...overrides,
  };
}

const classifierPolicy = {
  keywords: [],
  groupChat: {
    requireExplicitTrigger: false,
    autoAllowThreshold: 0.8,
    requireClassifierWindow: { minScore: 0.3, maxScore: 0.7 },
    classifierConfidenceThreshold: 0.7,
  },
  weights: {
    question: 0.4,
    random: 0,
  },
};

test('analyzeTrigger rejects empty and attachment-only messages when configured', async () => {
  const empty = await analyzeTrigger(groupEvent({ rawText: '', text: '' }), context(), {
    triggerPolicy: { hardDeny: { ignoreEmpty: true } },
  });
  assert.equal(empty.reason, 'empty-message');
  assert.equal(empty.shouldRespond, false);

  const attachment = await analyzeTrigger(groupEvent({
    rawText: '', text: '', attachments: [{ type: 'image', file: 'x' }],
  }), context(), {
    triggerPolicy: { hardDeny: { ignorePureAttachmentWithoutMention: true } },
  });
  assert.equal(attachment.reason, 'attachment-without-mention');
});

test('analyzeTrigger classifier window handles allow and deny decisions', async () => {
  const event = groupEvent({ rawText: '怎么回事', text: '怎么回事' });
  const classifierCalls = [];
  const allowed = await analyzeTrigger(event, context(), {
    random: () => 1,
    triggerPolicy: classifierPolicy,
    triggerClassifier: async (...args) => {
      classifierCalls.push(args);
      return { shouldRespond: true, confidence: 0.91, category: 'relevant' };
    },
  });
  assert.equal(allowed.reason, 'classifier-allow');
  assert.equal(allowed.shouldRespond, true);
  assert.match(allowed.ruleSignals.join(','), /classifier:relevant/);
  assert.equal(classifierCalls[0][1].recentSummary, 'recent context');

  const denied = await analyzeTrigger(event, context(), {
    random: () => 1,
    triggerPolicy: classifierPolicy,
    triggerClassifier: async () => ({ shouldRespond: true, confidence: 0.4, category: 'uncertain' }),
  });
  assert.equal(denied.reason, 'classifier-deny');
  assert.equal(denied.shouldRespond, false);
});

test('analyzeTrigger supports heuristic allow and low-confidence fallback', async () => {
  const event = groupEvent({ rawText: '怎么回事', text: '怎么回事' });
  const heuristic = await analyzeTrigger(event, context(), {
    random: () => 1,
    triggerPolicy: {
      ...classifierPolicy,
      classifier: { enabled: false },
      groupChat: { ...classifierPolicy.groupChat, autoAllowThreshold: 0.35 },
    },
  });
  assert.equal(heuristic.reason, 'heuristic-threshold-pass');
  assert.equal(heuristic.shouldRespond, true);

  const fallback = await analyzeTrigger(groupEvent(), context(), {
    random: () => 1,
    triggerPolicy: {
      keywords: [],
      classifier: { enabled: false },
      groupChat: { requireExplicitTrigger: false, autoAllowThreshold: 0.8, lowConfidenceFallback: 'deny' },
      weights: { random: 0 },
    },
  });
  assert.equal(fallback.reason, 'group-low-confidence');
  assert.equal(fallback.shouldRespond, false);
});

test('analyzeTriggerFast covers private, mention, command, keyword, and deny routes', () => {
  assert.equal(analyzeTriggerFast(groupEvent({ chatType: 'private', chatId: 'user-coverage' })).reason, 'private-default-reply');
  assert.match(analyzeTriggerFast(groupEvent({ mentionsBot: true })).reason, /direct-mention-pass/);
  assert.equal(analyzeTriggerFast(groupEvent({ rawText: '/help', text: '/help' })).reason, 'command-trigger');
  assert.equal(analyzeTriggerFast(groupEvent({ rawText: 'yuno help', text: 'yuno help' }), {
    triggerPolicy: { keywords: ['help'] },
  }).reason, 'keyword-trigger');
  assert.equal(analyzeTriggerFast(groupEvent()).reason, 'explicit-trigger-required');
});

test('analyzeTriggerFast rejects empty and attachment-only events', () => {
  assert.equal(analyzeTriggerFast(groupEvent({ rawText: '', text: '' })).reason, 'empty-message');
  assert.equal(analyzeTriggerFast(groupEvent({
    rawText: '', text: '', attachments: [{ type: 'file', file: 'x' }],
  }), {
    triggerPolicy: { hardDeny: { ignorePureAttachmentWithoutMention: true } },
  }).reason, 'attachment-without-mention');
});
