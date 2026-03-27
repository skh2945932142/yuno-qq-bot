import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolResultAsYuno } from './src/yuno-formatter.js';

test('formatter renders group reports without losing key fields', () => {
  const text = formatToolResultAsYuno({
    tool: 'group_report',
    payload: {
      windowHours: 24,
      totalMessages: 42,
      activeUsers: 8,
      topUsers: [{ name: 'Alice', count: 10 }],
      topTopics: [{ name: 'deploy', count: 8 }],
      anomalies: [],
    },
    summary: 'Last 24h: 42 messages from 8 active users.',
  }, { specialUser: null });

  assert.match(text, /42/);
  assert.match(text, /8 active users/);
  assert.match(text, /Alice/);
});

test('formatter renders reminder creation in a concise utility style', () => {
  const text = formatToolResultAsYuno({
    tool: 'reminder_created',
    payload: {
      payload: { delayMinutes: 15 },
    },
    summary: 'Reminder created.',
  }, { specialUser: null });

  assert.match(text, /15/);
  assert.match(text, /remind/i);
});
