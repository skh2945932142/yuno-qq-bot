import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInboundEvent } from './src/inbound-event-service.js';

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'group',
    chatId: 'group-1',
    userId: 'user-1',
    messageId: 'message-1',
    rawText: 'hello',
    source: { postType: 'message' },
    ...overrides,
  };
}

function createDeps(overrides = {}) {
  return {
    isNonTargetPokeEvent: () => false,
    observeGroupEvent: async () => null,
    evaluateGroupAutomation: async () => null,
    dispatchAutomationToolResults: async () => [],
    shouldRespondToEvent: async (event) => ({
      event,
      analysis: { shouldRespond: true, reason: 'allow' },
    }),
    onReplyApproved: async ({ event, decision }) => ({ event, decision }),
    recordWorkflowMetric: () => {},
    logger: { info() {}, warn() {} },
    ...overrides,
  };
}

test('handleInboundEvent suppresses non-target poke before observers and analysis', async () => {
  const calls = [];
  const result = await handleInboundEvent(createEvent(), {
    deps: createDeps({
      isNonTargetPokeEvent: () => true,
      observeGroupEvent: async () => calls.push('observe'),
      shouldRespondToEvent: async () => calls.push('decision'),
    }),
  });

  assert.equal(result.suppressed, true);
  assert.equal(result.reason, 'non-target-poke');
  assert.deepEqual(calls, []);
});

test('handleInboundEvent runs group observation and automation through the shared lifecycle', async () => {
  const calls = [];
  const result = await handleInboundEvent(createEvent(), {
    deps: createDeps({
      observeGroupEvent: async () => calls.push('observe'),
      evaluateGroupAutomation: async () => ({
        suppressNormalReply: true,
        toolResults: [{ tool: 'automation_keyword_alert' }],
      }),
      dispatchAutomationToolResults: async (_event, toolResults) => {
        calls.push(`dispatch:${toolResults[0].tool}`);
        return ['automation-output'];
      },
      shouldRespondToEvent: async (event) => {
        calls.push('decision');
        return { event, analysis: { shouldRespond: true, reason: 'allow' } };
      },
      onReplyApproved: async () => calls.push('reply'),
    }),
  });

  assert.equal(result.suppressed, true);
  assert.equal(result.reason, 'automation-suppressed');
  assert.deepEqual(result.automationOutputs, ['automation-output']);
  assert.equal(calls.includes('observe'), true);
  assert.equal(calls.includes('decision'), true);
  assert.equal(calls.includes('dispatch:automation_keyword_alert'), true);
  assert.equal(calls.includes('reply'), false);
});

test('handleInboundEvent delegates approved replies without owning delivery semantics', async () => {
  const event = createEvent({ chatType: 'private', chatId: 'user-1' });
  const result = await handleInboundEvent(event, {
    deps: createDeps({
      onReplyApproved: async ({ decision }) => `reply:${decision.analysis.reason}`,
    }),
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.reason, 'allow');
  assert.equal(result.replyResult, 'reply:allow');
});

test('handleInboundEvent treats group increase as automation-only input', async () => {
  let replyCalled = false;
  const event = createEvent({ source: { noticeType: 'group_increase' } });
  const result = await handleInboundEvent(event, {
    deps: createDeps({
      evaluateGroupAutomation: async () => ({
        suppressNormalReply: true,
        toolResults: [{ tool: 'automation_welcome' }],
      }),
      dispatchAutomationToolResults: async () => ['welcome-output'],
      onReplyApproved: async () => { replyCalled = true; },
    }),
  });

  assert.equal(result.suppressed, true);
  assert.equal(result.reason, 'automation-notice');
  assert.deepEqual(result.automationOutputs, ['welcome-output']);
  assert.equal(replyCalled, false);
});
