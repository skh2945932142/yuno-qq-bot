import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolResultAsYuno, normalizeFormatterOutputs } from './src/yuno-formatter.js';

test('formatter renders meme results and preserves image output', () => {
  const toolResult = {
    tool: 'meme_retrieve',
    payload: {
      action: 'send-existing',
      image: { file: 'data:image/png;base64,AAA' },
    },
    summary: '',
  };

  const text = formatToolResultAsYuno(toolResult, { specialUser: null });
  const outputs = normalizeFormatterOutputs(toolResult, text);

  assert.match(text, /这|梗图|合适/);
  assert.equal(outputs.length, 2);
  assert.equal(outputs[1].type, 'image');
});

test('formatter renders empty, failed, permission, and knowledge-missing results naturally', () => {
  const emptyText = formatToolResultAsYuno({
    tool: 'meme_search',
    payload: { count: 0 },
    summary: '',
    safetyFlags: ['tool-empty'],
  });
  const failedText = formatToolResultAsYuno({
    tool: 'group_report',
    payload: { reason: 'upstream timeout' },
    status: 'error',
    summary: '',
  });
  const permissionText = formatToolResultAsYuno({
    tool: 'debug_why',
    payload: { reason: 'requires admin permission' },
    safetyFlags: ['permission-denied'],
    summary: '',
  });
  const knowledgeText = formatToolResultAsYuno({
    tool: 'knowledge_lookup',
    payload: { documents: [] },
    safetyFlags: ['knowledge-empty'],
    summary: '',
  });

  assert.match(emptyText, /没有拿到可用结果|没找到/);
  assert.match(failedText, /没跑稳|原因/);
  assert.match(permissionText, /权限|不能直接/);
  assert.match(knowledgeText, /可靠依据|不想骗你/);
  assert.doesNotMatch(`${emptyText} ${failedText} ${permissionText} ${knowledgeText}`, /\bDone\b|\bSuccess\b|\bError\b/i);
});

test('formatter keeps key fields in personalized tool replies', () => {
  const reminderText = formatToolResultAsYuno({
    tool: 'reminder_created',
    payload: {
      delayMinutes: 20,
      text: '喝水',
    },
    summary: '',
  });
  const watchText = formatToolResultAsYuno({
    tool: 'keyword_watch_added',
    payload: {
      pattern: '发版',
    },
    summary: '',
  });
  const cancelText = formatToolResultAsYuno({
    tool: 'subscription_cancelled',
    payload: {
      taskId: 'sub-42',
      cancelled: true,
    },
    summary: '',
  });

  assert.match(reminderText, /20|喝水/);
  assert.match(watchText, /发版/);
  assert.match(cancelText, /sub-42/);
});
