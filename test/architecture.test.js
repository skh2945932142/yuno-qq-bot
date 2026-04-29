import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnebotMessageEvent } from '../src/adapters/onebot-event.js';
import { createApp } from '../src/bootstrap-phase1.js';
import { logger } from '../src/logger.js';
import { planIncomingTask } from '../src/task-router.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { registerQueryTools } from '../src/query-tools.js';

test('validateOnebotMessageEvent rejects unsupported payloads', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'notice',
    message_type: 'private',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(','), /supported OneBot message or notice/);
  assert.equal(result.reason, 'invalid_payload');
});

test('validateOnebotMessageEvent classifies meta events as ignorable system payloads', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'meta_event',
    meta_event_type: 'heartbeat',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'system_payload');
});

test('createApp silently ignores unsupported system payloads', async () => {
  const infoLogs = [];
  const originalInfo = logger.info;
  const originalError = logger.error;
  const app = createApp();

  try {
    logger.info = (...args) => infoLogs.push(args);
    logger.error = () => {};

    await new Promise((resolve, reject) => {
      const req = {
        method: 'POST',
        url: '/onebot',
        headers: { 'content-type': 'application/json' },
        body: { post_type: 'meta_event', meta_event_type: 'heartbeat' },
        on() {},
      };
      const res = {
        setHeader() {},
        getHeader() { return undefined; },
        removeHeader() {},
        end() { resolve(); },
        send() { resolve(); },
        status() { return this; },
      };

      app.handle(req, res, reject);
    });

    assert.equal(infoLogs.some((entry) => entry[1] === 'Ignored unsupported webhook payload'), false);
  } finally {
    logger.info = originalInfo;
    logger.error = originalError;
  }
});

test('planIncomingTask routes command messages to tools', () => {
  const task = planIncomingTask({
    event: { chatType: 'private', rawText: '/profile' },
    text: '/profile',
    analysis: { shouldRespond: true, reason: 'private-default-reply' },
    conversationState: { messages: [], rollingSummary: '' },
  });

  assert.equal(task.type, 'tool');
  assert.equal(task.toolName, 'get_profile');
});

test('tool registry executes structured query tools', async () => {
  const registry = registerQueryTools(createToolRegistry({
    logger: { info: () => {}, error: () => {} },
  }));

  const result = await registry.execute('get_relation', {}, {
    relation: { affection: 77, activeScore: 33 },
    userState: { currentEmotion: 'CALM' },
    groupState: null,
    event: { chatType: 'private' },
  });

  assert.equal(result.tool, 'get_relation');
  assert.equal(result.payload.affection, 77);
  assert.match(result.summary, /77/);
});
