import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYunoCoreEvent, runYunoConversation } from './src/yuno-core.js';
import { createDeliveryLedger } from './src/delivery-ledger.js';

test('buildYunoCoreEvent normalizes generic platform input into unified event', () => {
  const event = buildYunoCoreEvent({
    platform: 'telegram',
    scene: 'private',
    userId: '42',
    username: 'Scathach',
    rawMessage: 'hello',
    metadata: {
      messageId: 'msg-1',
      mentionsBot: true,
    },
  });

  assert.equal(event.platform, 'telegram');
  assert.equal(event.chatType, 'private');
  assert.equal(event.chatId, '42');
  assert.equal(event.userId, '42');
  assert.equal(event.userName, 'Scathach');
  assert.equal(event.rawText, 'hello');
});

test('runYunoConversation captures output without using platform sender', async () => {
  const result = await runYunoConversation({
    platform: 'qq',
    scene: 'private',
    userId: '10001',
    username: 'Alice',
    rawMessage: 'what can you do?',
  }, {
    engine: {
      shouldRespondToEvent: async (event) => ({
        event,
        analysis: {
          shouldRespond: true,
          confidence: 0.9,
          intent: 'query',
          sentiment: 'neutral',
          relevance: 0.9,
          reason: 'test',
          topics: [],
          ruleSignals: ['private-chat'],
          replyStyle: 'calm',
        },
      }),
      processIncomingMessage: async (_event, _decision, runtimeOptions) => {
        await runtimeOptions.deps.sendReply({ platform: 'qq', chatType: 'private', chatId: '10001' }, 'test reply');
        return 'test reply';
      },
    },
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.response.text, 'test reply');
  assert.equal(result.outputs.replies[0].text, 'test reply');
});

test('runYunoConversation exposes plugin routes synchronously to the workflow', async () => {
  let capturedRoute = null;
  const result = await runYunoConversation({
    platform: 'qq',
    scene: 'private',
    userId: '10001',
    username: 'Alice',
    rawMessage: 'tell me about the knowledge base',
  }, {
    pluginRoute: 'knowledge_qa',
    engine: {
      shouldRespondToEvent: async (event) => ({
        event,
        analysis: {
          shouldRespond: true,
          confidence: 0.9,
          intent: 'query',
          sentiment: 'neutral',
          relevance: 0.9,
          reason: 'test',
          topics: [],
          ruleSignals: ['private-chat'],
          replyStyle: 'calm',
        },
      }),
      processIncomingMessage: async (_event, _decision, runtimeOptions) => {
        capturedRoute = runtimeOptions.deps.planIncomingTask();
        return 'routed reply';
      },
    },
  });

  assert.equal(result.response.text, 'routed reply');
  assert.equal(capturedRoute.category, 'knowledge_qa');
  assert.equal(capturedRoute.requiresRetrieval, true);
  assert.equal(capturedRoute.requiresModel, true);
});

test('runYunoConversation formats tool results into unified outputs', async () => {
  const result = await runYunoConversation({
    platform: 'qq',
    scene: 'private',
    userId: '10001',
    username: 'Alice',
    rawMessage: '/help',
  }, {
    context: {
      relation: { affection: 20 },
    },
    toolResult: {
      tool: 'meme_generate',
      payload: {
        action: 'generate-quote',
        image: { file: 'data:image/png;base64,AAA' },
      },
      summary: '',
      visibility: 'default',
      safetyFlags: [],
    },
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.response.outputs.length, 2);
  assert.equal(result.response.outputs[0].type, 'text');
  assert.equal(result.response.outputs[1].type, 'image');
});

test('runYunoConversation toolResult path creates a trace when one is not provided', async () => {
  const result = await runYunoConversation({
    platform: 'qq',
    scene: 'group',
    groupId: '20001',
    chatId: '20001',
    userId: '10001',
    username: 'Alice',
    rawMessage: '/digest',
    metadata: {
      messageId: 'msg-tool-1',
      source: { adapter: 'scheduler' },
    },
  }, {
    deps: {
      ensureRelation: async () => ({ affection: 20, activeScore: 5 }),
      ensureUserState: async () => ({ currentEmotion: 'CALM', intensity: 0.2 }),
      ensureUserProfileMemory: async () => ({ bondMemories: [], specialNicknames: [] }),
      getConversationState: async () => ({ messages: [], rollingSummary: '' }),
      ensureGroupState: async () => null,
      getRecentEvents: async () => [],
    },
    toolResult: {
      tool: 'group_daily_digest',
      payload: {
        summary: '今天群里主要在聊发布和排障。',
      },
      summary: '今天群里主要在聊发布和排障。',
      visibility: 'group',
      safetyFlags: [],
    },
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.analysis.reason, 'tool-result');
  assert.ok(Array.isArray(result.response.outputs));
  assert.ok(result.response.outputs.length >= 1);
  assert.equal(result.response.outputs[0].type, 'text');
});

test('runYunoConversation returns suppressed capture output without running reply workflow', async () => {
  let processCalled = false;
  const result = await runYunoConversation({
    platform: 'qq', scene: 'group', groupId: 'g1', userId: 'u1', rawMessage: 'chatter',
  }, {
    engine: {
      shouldRespondToEvent: async (event) => ({ event, analysis: { shouldRespond: false, reason: 'explicit-trigger-required' } }),
      processIncomingMessage: async () => { processCalled = true; return 'unexpected'; },
    },
  });
  assert.equal(result.suppressed, true);
  assert.equal(result.response, null);
  assert.equal(processCalled, false);
  assert.deepEqual(result.outputs, { replies: [], voices: [], outputs: [] });
});

test('runYunoConversation send mode forwards text, structured, and voice outputs to injected senders', async () => {
  const sent = [];
  const result = await runYunoConversation({
    platform: 'qq', scene: 'private', userId: 'u1', rawMessage: 'hello',
  }, {
    responseMode: 'send',
    deps: {
      sendReply: async (...args) => sent.push(['text', args]),
      sendStructuredReply: async (...args) => sent.push(['structured', args]),
      sendVoice: async (...args) => sent.push(['voice', args]),
    },
    engine: {
      shouldRespondToEvent: async (event) => ({ event, analysis: { shouldRespond: true, reason: 'allow' } }),
      processIncomingMessage: async (_event, _decision, options) => {
        await options.deps.sendReply({ platform: 'qq', chatType: 'private', chatId: 'u1' }, 'reply');
        await options.deps.sendStructuredReply({ platform: 'qq', chatType: 'private', chatId: 'u1' }, [{ type: 'image', image: 'x' }]);
        await options.deps.sendVoice({ platform: 'qq', chatType: 'private', chatId: 'u1' }, Buffer.from('audio'));
        return 'reply';
      },
    },
  });
  assert.equal(result.response.text, 'reply');
  assert.equal(sent.length, 3);
  assert.equal(sent[0][0], 'text');
  assert.equal(sent[1][0], 'structured');
  assert.equal(sent[2][0], 'voice');
});

test('runYunoConversation uses the shared inbound lifecycle for external adapters', async () => {
  const calls = [];
  const result = await runYunoConversation({
    platform: 'qq', scene: 'group', groupId: 'g1', userId: 'u1', rawMessage: 'hello',
  }, {
    processInboundLifecycle: true,
    deps: {
      isNonTargetPokeEvent: () => false,
      observeGroupEvent: async () => calls.push('observe'),
      evaluateGroupAutomation: async () => {
        calls.push('automation');
        return null;
      },
    },
    engine: {
      shouldRespondToEvent: async (event) => {
        calls.push('decision');
        return { event, analysis: { shouldRespond: true, reason: 'allow' } };
      },
      processIncomingMessage: async (_event, _decision, options) => {
        calls.push('reply');
        await options.deps.sendReply({ platform: 'qq', chatType: 'group', chatId: 'g1' }, 'shared reply');
        return 'shared reply';
      },
    },
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.response.text, 'shared reply');
  assert.equal(calls.includes('observe'), true);
  assert.equal(calls.includes('automation'), true);
  assert.equal(calls.includes('decision'), true);
  assert.equal(calls.includes('reply'), true);
});

test('runYunoConversation returns automation output when automation suppresses the normal reply', async () => {
  let replyCalled = false;
  const result = await runYunoConversation({
    platform: 'qq', scene: 'group', groupId: 'g1', userId: 'u1', rawMessage: 'keyword',
  }, {
    processInboundLifecycle: true,
    context: {
      relation: { affection: 20 },
    },
    deps: {
      isNonTargetPokeEvent: () => false,
      observeGroupEvent: async () => null,
      evaluateGroupAutomation: async () => ({
        suppressNormalReply: true,
        toolResults: [{
          tool: 'automation_keyword_alert',
          payload: { keyword: 'keyword', text: 'keyword' },
          summary: 'keyword alert',
          visibility: 'group',
          safetyFlags: [],
        }],
      }),
    },
    engine: {
      shouldRespondToEvent: async (event) => ({
        event,
        analysis: { shouldRespond: true, reason: 'allow' },
      }),
      processIncomingMessage: async () => {
        replyCalled = true;
        return 'unexpected';
      },
    },
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.analysis.reason, 'allow');
  assert.equal(replyCalled, false);
  assert.ok(result.response.outputs.length >= 1);
  assert.equal(result.response.outputs[0].type, 'text');
});

test('runYunoConversation capture mode never claims the direct-delivery ledger', async () => {
  let ledgerCalls = 0;
  let senderCalls = 0;
  const result = await runYunoConversation({
    platform: 'qq',
    scene: 'private',
    userId: 'u1',
    rawMessage: '/capture',
    metadata: { messageId: 'capture-ledger-1' },
  }, {
    responseMode: 'capture',
    context: { relation: { affection: 20 } },
    deps: {
      executeDelivery: async () => {
        ledgerCalls += 1;
        throw new Error('capture must not touch delivery ledger');
      },
      sendStructuredReply: async () => {
        senderCalls += 1;
        return true;
      },
    },
    toolResult: {
      tool: 'group_daily_digest',
      payload: { summary: 'capture output' },
      summary: 'capture output',
      visibility: 'default',
      safetyFlags: [],
    },
  });

  assert.equal(result.suppressed, false);
  assert.equal(result.response.text.length > 0, true);
  assert.equal(ledgerCalls, 0);
  assert.equal(senderCalls, 0);
});

test('runYunoConversation send-mode tool results use the delivery ledger', async () => {
  const records = [];
  const sent = [];
  const ledger = createDeliveryLedger({
    records,
    now: () => new Date('2026-07-23T12:00:00Z'),
  });
  const input = {
    platform: 'qq',
    scene: 'group',
    groupId: 'g1',
    chatId: 'g1',
    userId: 'scheduler',
    rawMessage: 'scheduled reminder',
    metadata: { messageId: 'scheduler-task-1' },
  };
  const options = {
    responseMode: 'send',
    deliveryKey: 'scheduler:scheduler-task-1:2026-07-23T12:00:00.000Z',
    context: { relation: { affection: 20 } },
    deps: {
      executeDelivery: ledger.execute,
      sendStructuredReply: async (_target, outputs) => {
        sent.push(outputs);
        return true;
      },
    },
    toolResult: {
      tool: 'automation_reminder',
      payload: { message: 'scheduled reminder' },
      summary: 'scheduled reminder',
      visibility: 'group',
      safetyFlags: [],
    },
  };

  const first = await runYunoConversation(input, options);
  const duplicate = await runYunoConversation(input, options);

  assert.equal(sent.length, 1);
  assert.equal(first.delivery.status, 'sent');
  assert.equal(first.delivery.deduplicated, false);
  assert.equal(duplicate.delivery.status, 'sent');
  assert.equal(duplicate.delivery.deduplicated, true);
  assert.equal(records[0].deliveryKey, options.deliveryKey);
  assert.equal(records[0].attempts, 1);
});
