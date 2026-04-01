import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnebotMessageEvent } from '../src/adapters/onebot-event.js';
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
