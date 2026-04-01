import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolResultAsYuno } from './src/yuno-formatter.js';
import { getToolDefinitions } from './src/tool-config.js';

test('formatter keeps tool replies Chinese-first and avoids old English panel phrases', () => {
  const reportText = formatToolResultAsYuno({
    tool: 'group_report',
    payload: {
      windowHours: 24,
      totalMessages: 42,
      activeUsers: 8,
      topUsers: [{ name: 'Alice', count: 10 }],
      topTopics: [{ name: 'deploy', count: 8 }],
      anomalies: [],
    },
    summary: '最近 24 小时里一共 42 条消息，活跃了 8 个人。',
  });

  const reminderText = formatToolResultAsYuno({
    tool: 'reminder_created',
    payload: {
      delayMinutes: 15,
      text: '记得喝水',
    },
    summary: '提醒已经记下了。',
  });

  assert.doesNotMatch(reportText, /\bI checked\b|\bDaily digest\b|\bHere is\b/i);
  assert.doesNotMatch(reminderText, /\bReminder\b|\bminute\(s\)\b/i);
  assert.match(reportText, /群里|活跃|话题/);
  assert.match(reminderText, /提醒|15/);
});

test('tool definition fallback messages are localized for user-visible paths', () => {
  const definitions = getToolDefinitions();
  for (const definition of definitions) {
    assert.doesNotMatch(definition.fallbackMessage, /\bI could not\b|\bThere is no\b/i);
  }
});
