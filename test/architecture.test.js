import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGroupMessageEvent } from '../src/schemas/group-message-event.js';
import { planIncomingTask } from '../src/agents/task-router.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { registerQueryTools } from '../src/tools/query-tools.js';

test('validateGroupMessageEvent rejects unsupported payloads', () => {
  const result = validateGroupMessageEvent({
    post_type: 'notice',
    message_type: 'private',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(','), /post_type/);
});

test('planIncomingTask routes command messages to tools', () => {
  const task = planIncomingTask({
    text: '/profile',
    analysis: { shouldRespond: true, reason: 'basic-rule-pass' },
  });

  assert.equal(task.type, 'tool');
  assert.equal(task.toolName, 'get_profile');
});

test('tool registry executes structured query tools', async () => {
  const registry = registerQueryTools(createToolRegistry({
    logger: {
      info: () => {},
      error: () => {},
    },
  }));

  const result = await registry.execute('get_relation', {}, {
    relation: { affection: 77, activeScore: 33 },
    userState: { currentEmotion: 'CALM' },
    groupState: null,
  });

  assert.equal(result.type, 'relation');
  assert.equal(result.data.affection, 77);
  assert.match(result.text, /77/);
});
