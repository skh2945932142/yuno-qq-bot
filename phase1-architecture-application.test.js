import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createYunoApplication } from './src/application/create-yuno-application.js';
import { runYunoConversation } from './src/yuno-core.js';
import { resetRuntimeServices, setRuntimeServices } from './src/runtime-services.js';
import { handleScheduledInteraction } from './src/application/use-cases/handle-scheduled-interaction.js';
import { createDecideReplyUseCase } from './src/application/use-cases/decide-reply.js';
import { createGenerateReplyUseCase } from './src/application/use-cases/generate-reply.js';
import { createDeliverReplyUseCase } from './src/application/use-cases/deliver-reply.js';
import { createPersistReplyUseCase } from './src/application/use-cases/persist-reply.js';
import { createReplyPlan } from './src/application/contracts/reply-plan.js';

const root = path.dirname(fileURLToPath(import.meta.url));

function createPorts(calls) {
  const noop = () => {};
  return {
    conversation: {
      ensureRelation: async () => ({ _id: 'relation-1' }),
      ensureUserState: async () => ({ _id: 'user-state-1' }),
      getConversationState: async () => ({ messages: [] }),
      appendConversationMessages: async () => {},
      updateRelationProfile: async () => {},
      updateUserState: async () => {},
    },
    memory: {
      ensureUserProfile: async () => ({ _id: 'profile-1' }),
      updateUserProfile: async () => {},
      retrieveContext: async () => ({ eventMemories: [], memeMemories: [] }),
      persistEvents: async () => [],
      indexEvents: async () => {},
      touchEvents: async () => {},
      collectMeme: async () => null,
      indexMeme: async () => {},
    },
    decision: {
      analyzeTriggerFast: () => ({ shouldRespond: true, reason: 'private-default', confidence: 1 }),
      analyzeTrigger: async () => ({ shouldRespond: true, reason: 'slow' }),
      ensureGroupState: async () => null,
      getRecentEvents: async () => [],
      resolveSpecialUser: () => null,
    },
    model: {
      analyzeMessage: async () => null,
      generateReply: async () => 'unused',
      generateVoice: async () => Buffer.from('voice'),
    },
    retrieval: {},
    tools: { execute: async () => ({}) },
    delivery: {
      sendReply: async () => {
        calls.push('default-send');
        return true;
      },
      sendStructuredReply: async () => {
        calls.push('default-structured');
        return true;
      },
      sendVoice: async () => true,
      executeTracked: async (_key, _meta, task) => ({
        sent: true,
        deduplicated: false,
        status: 'sent',
        value: await task(),
      }),
    },
    jobs: {
      enqueueReply: async (job, options) => {
        calls.push({ replyJob: job, options });
        return { id: options.jobId || 'reply-job' };
      },
      enqueuePersist: async (job, options) => {
        calls.push({ job, options });
        return { id: options.jobId || 'persist-job' };
      },
    },
    telemetry: { logger: { info: noop, warn: noop, error: noop }, recordMetric: noop },
    tracing: {
      createTraceContext: () => ({ traceId: 'trace-1' }),
      finalizeTrace: noop,
      failTrace: noop,
      withTraceSpan: async (_trace, _name, task) => task(),
    },
  };
}

function createLegacyWorkflow(calls) {
  return {
    async shouldRespondToEvent() {
      throw new Error('production decision port should be used');
    },
    async handleInboundEvent(event, options) {
      const decision = await options.deps.shouldRespondToEvent(event, options.decisionOptions);
      const replyResult = await options.deps.onReplyApproved({ event, decision });
      return { ok: true, event, decision, replyResult };
    },
    async processIncomingMessage(event, _decision, options) {
      await options.deps.sendStructuredReply({
        platform: event.platform,
        chatType: event.chatType,
        chatId: event.chatId,
      }, [{ type: 'text', text: 'captured reply' }]);
      await options.deps.enqueuePersistJob({
        event,
        contextSnapshot: { session: { chatId: event.chatId } },
        nextMessages: [],
        rawText: event.rawText,
        userTurn: event.rawText,
        analysis: { shouldRespond: true },
        emotionResult: { emotion: 'neutral' },
        summary: 'summary',
        username: event.userName,
      }, { jobId: 'persist:captured' });
      return 'captured reply';
    },
    async processPersistJob(job) {
      calls.push({ persisted: job });
      return true;
    },
    async processReplyJob() {
      return true;
    },
  };
}

test('application separates generation, delivery, and versioned persistence jobs', async () => {
  const calls = [];
  const config = {
    adminQq: 'admin',
    privateSemanticAnalysisEnabled: false,
  };
  const application = createYunoApplication({
    config,
    ports: createPorts(calls),
    legacyWorkflow: createLegacyWorkflow(calls),
  });
  const capturedOutputs = [];
  const result = await application.handleInboundEvent({
    platform: 'qq',
    chatType: 'private',
    chatId: 'u1',
    userId: 'u1',
    userName: 'u1',
    rawText: 'hello',
    text: 'hello',
  }, {
    responseMode: 'capture',
    persistInline: false,
    decisionOptions: {
      deps: {
        sendStructuredReply: async (_target, outputs) => {
          capturedOutputs.push(...outputs);
          return true;
        },
        executeDelivery: null,
      },
    },
  });

  assert.equal(result.replyResult, 'captured reply');
  assert.deepEqual(capturedOutputs, [{ type: 'text', text: 'captured reply' }]);
  assert.equal(calls.includes('default-send'), false);
  assert.equal(calls.includes('default-structured'), false);
  const queued = calls.find((item) => item?.job);
  assert.equal(queued.job.version, 1);
  assert.equal(queued.job.kind, 'persist');

  await application.enqueueReply({ event: { chatId: 'u1' } }, { jobId: 'reply:captured' });
  const queuedReply = calls.find((item) => item?.replyJob);
  assert.equal(queuedReply.replyJob.version, 1);
  assert.equal(queuedReply.replyJob.kind, 'reply');

  await application.handlePersistJob(queued.job, { id: 'persist-1' });
  assert.equal(calls.some((item) => item?.persisted), true);
});

test('application use cases keep decision, generation, delivery, and persistence side effects isolated', async () => {
  const calls = [];
  const ports = createPorts(calls);
  const event = {
    platform: 'qq',
    chatType: 'private',
    chatId: 'u1',
    userId: 'u1',
    userName: 'u1',
    rawText: 'hello',
    text: 'hello',
  };
  const legacy = createLegacyWorkflow(calls);

  const decideReply = createDecideReplyUseCase({
    config: { adminQq: 'admin', privateSemanticAnalysisEnabled: false },
    ports,
    legacyWorkflow: legacy,
  });
  const decision = await decideReply(event);
  assert.equal(decision.analysis.shouldRespond, true);
  assert.equal(calls.includes('default-send'), false);
  assert.equal(calls.some((item) => item?.persisted), false);

  const generateReply = createGenerateReplyUseCase({
    config: { adminQq: 'admin' },
    legacyWorkflow: legacy,
  });
  const generated = await generateReply(event, decision);
  assert.equal(generated.replyPlan.outputs[0].text, 'captured reply');
  assert.equal(calls.includes('default-send'), false);
  assert.equal(calls.some((item) => item?.persisted), false);

  let deliveryCalls = 0;
  const deliverReply = createDeliverReplyUseCase({
    ports: {
      delivery: {
        sendReply: async () => { deliveryCalls += 1; return true; },
        sendStructuredReply: null,
        sendVoice: null,
        executeTracked: null,
      },
    },
  });
  await deliverReply(createReplyPlan({
    event,
    target: { platform: 'qq', chatType: 'private', chatId: 'u1' },
    outputs: [{ type: 'text', text: 'send me' }],
  }));
  assert.equal(deliveryCalls, 1);

  let persisted = false;
  const persistReply = createPersistReplyUseCase({
    config: {},
    legacyWorkflow: {
      processPersistJob: async () => { persisted = true; return true; },
    },
  });
  await persistReply({
    event,
    contextSnapshot: {},
    payload: { nextMessages: [] },
  });
  assert.equal(persisted, true);
});

test('runYunoConversation uses the composed application without bypassing capture delivery', async () => {
  const calls = [];
  const application = createYunoApplication({
    config: { adminQq: 'admin', privateSemanticAnalysisEnabled: false },
    ports: createPorts(calls),
    legacyWorkflow: createLegacyWorkflow(calls),
  });
  setRuntimeServices({ application });
  try {
    const result = await runYunoConversation({
      platform: 'qq',
      scene: 'private',
      userId: 'u1',
      chatId: 'u1',
      username: 'u1',
      rawMessage: 'hello',
    }, { responseMode: 'capture' });

    assert.equal(result.suppressed, false);
    assert.equal(result.outputs.outputs[0].text, 'captured reply');
    assert.equal(calls.includes('default-structured'), false);
  } finally {
    resetRuntimeServices();
  }
});

test('proactive scheduler use case creates a ledger-ready delivery request', async () => {
  const delivered = [];
  const result = await handleScheduledInteraction({
    groupId: 'g1',
    now: new Date('2026-08-09T08:00:00.000Z'),
    runtimeConfig: { proactiveMessagesEnabled: true, adminQq: 'admin' },
  }, {
    createTraceContext: () => ({ traceId: 'scheduled-trace' }),
    withTraceSpan: async (_trace, _name, task) => task(),
    finalizeTrace: () => {},
    failTrace: () => {},
    logger: { info: () => {}, error: () => {} },
    ensureGroupState: async () => ({}),
    getRecentEvents: async () => [],
    planScheduledInteraction: () => ({ shouldSend: true, reason: 'morning', topic: 'hello', tone: 'soft' }),
    buildScheduledPrompt: () => 'prompt',
    generateReply: async () => 'good morning',
    deliverReply: async (plan) => {
      delivered.push(plan);
      return { delivery: { sent: true, status: 'sent' } };
    },
    markProactiveSent: async () => {},
    logSchedulerSkip: () => {},
  });

  assert.equal(result.skipped, false);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].deliveryKey, /^scheduler:proactive:g1:/);
  assert.equal(delivered[0].outputs[0].text, 'good morning');
});

test('application modules do not import delivery, protocol, or runtime service internals', () => {
  const applicationRoot = path.join(root, 'src', 'application');
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
    }
  };
  visit(applicationRoot);

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.equal(imports.some((specifier) => /(?:sender\.js|koishi|runtime-services\.js|adapter-onebot)/.test(specifier)), false, file);
  }

  const facade = fs.readFileSync(path.join(root, 'src', 'message-workflow.js'), 'utf8');
  assert.match(facade, /export \* from '.\/legacy\/message-workflow-kernel\.js'/);
  assert.ok(facade.length < 300);

  const scheduler = fs.readFileSync(path.join(root, 'src', 'jobs', 'scheduler-job.js'), 'utf8');
  assert.equal(scheduler.includes("from '../sender.js'"), false);
  assert.equal(scheduler.includes("from '../minimax.js'"), false);

  const legacyKernel = fs.readFileSync(path.join(root, 'src', 'legacy', 'message-workflow-kernel.js'), 'utf8');
  assert.equal(legacyKernel.includes('recordInboundMessageLog(normalizedEvent)'), false);
});
