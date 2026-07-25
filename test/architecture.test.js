import test from 'node:test';
import assert from 'node:assert/strict';
import { planIncomingTask } from '../src/task-router.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { registerQueryTools } from '../src/query-tools.js';

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
