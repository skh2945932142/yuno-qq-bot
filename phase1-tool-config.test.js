import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from './src/command-parser.js';
import { getToolDefinitions } from './src/tool-config.js';
import { planIncomingTask } from './src/task-router.js';

test('command parser uses declarative tool definitions', () => {
  const parsed = parseCommand('/profile');
  const definitions = getToolDefinitions();

  assert.equal(parsed.toolName, 'get_profile');
  assert.ok(definitions.some((item) => item.name === 'get_profile'));
});

test('tool routing respects allowIn metadata', () => {
  const task = planIncomingTask({
    event: {
      platform: 'qq',
      chatType: 'private',
      chatId: '10001',
      userId: '10001',
      rawText: '/group',
    },
    text: '/group',
    analysis: { shouldRespond: true, reason: 'private-default-reply' },
    conversationState: { messages: [] },
  });

  assert.equal(task.type, 'ignore');
  assert.equal(task.reason, 'tool-not-allowed-in-chat');
});
