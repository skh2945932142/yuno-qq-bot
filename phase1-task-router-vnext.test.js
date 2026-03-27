import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from './src/command-parser.js';
import { planIncomingTask } from './src/task-router.js';

test('command parser extracts tool args for reports and reminders', () => {
  const report = parseCommand('/groupreport 48');
  const reminder = parseCommand('/remind add 15 call mom');

  assert.equal(report.toolName, 'get_group_report');
  assert.equal(report.toolArgs.windowHours, 48);
  assert.equal(reminder.toolName, 'add_reminder');
  assert.equal(reminder.toolArgs.delayMinutes, 15);
  assert.equal(reminder.toolArgs.text, 'call mom');
});

test('planIncomingTask preserves parsed tool args for command tools', () => {
  const task = planIncomingTask({
    event: {
      platform: 'qq',
      chatType: 'private',
      chatId: 'u1',
      userId: 'u1',
      rawText: '/remind add 20 stand up',
    },
    text: '/remind add 20 stand up',
    analysis: { shouldRespond: true, reason: 'private-default-reply' },
    conversationState: { messages: [] },
  });

  assert.equal(task.type, 'tool');
  assert.equal(task.toolName, 'add_reminder');
  assert.equal(task.toolArgs.delayMinutes, 20);
});
