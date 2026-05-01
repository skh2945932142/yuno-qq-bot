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

test('command parser recognizes companion memory and meme commands', () => {
  assert.equal(parseCommand('/memory').toolName, 'get_memory');
  assert.deepEqual(parseCommand('/forget 面试').toolArgs, { query: '面试' });
  assert.equal(parseCommand('/style').toolName, 'get_style');
  assert.deepEqual(parseCommand('/style set tone 温柔一点').toolArgs, {
    key: 'tone',
    value: '温柔一点',
  });
  assert.deepEqual(parseCommand('/meme search 破防').toolArgs, { query: '破防' });
  assert.deepEqual(parseCommand('/meme optout').toolArgs, { optOut: true });
  assert.equal(parseCommand('/debug why').toolName, 'debug_why');
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
