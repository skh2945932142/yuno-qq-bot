import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStructuredToolResult,
  formatToolResultAsYuno,
  normalizeFormatterOutputs,
  summarizeToolPayload,
} from './src/yuno-formatter.js';

function render(tool, payload = {}, extra = {}, policy = {}) {
  return formatToolResultAsYuno({ tool, payload, ...extra }, policy);
}

test('formatter covers status, report, watch, reminder, and subscription renderers', () => {
  for (const tool of ['get_relation', 'get_emotion', 'get_group_state', 'get_profile', 'get_memory', 'get_style', 'get_help']) {
    assert.ok(render(tool, { affection: 70, currentEmotion: 'CALM', emotion: 'CURIOUS', intensity: 0.5, mood: 'CALM', activityLevel: 50, recentTopics: ['x'], memorySummary: 'profile', commands: ['/help'] }, { summary: 'summary' }).length > 0);
  }
  assert.match(render('group_report', { windowHours: 1, totalMessages: 2, activeUsers: 1 }), /2/);
  assert.match(render('activity_leaderboard', { leaders: [] }), /没有/);
  assert.match(render('activity_leaderboard', { leaders: [{ name: 'A', count: 2 }] }), /A/);
  assert.match(render('group_daily_digest', { totalMessages: 3, activeUsers: 2, topUsers: [], topTopics: [] }), /暂无/);
  assert.match(render('keyword_watch_added', { pattern: 'deploy' }), /deploy/);
  assert.match(render('keyword_watch_removed', { keyword: 'deploy', removed: true }), /不再/);
  assert.match(render('keyword_watch_removed', { keyword: 'deploy', removed: false }), /没找到/);
  assert.match(render('keyword_watch_list', { rules: [] }), /没有/);
  assert.match(render('keyword_watch_list', { rules: [{ pattern: 'deploy' }] }), /deploy/);
  assert.match(render('automation_keyword_alert', { username: 'A', keyword: 'deploy', summary: 'found' }), /found/);
  assert.match(render('reminder_created', { delayMinutes: 5, text: 'drink' }), /drink/);
  assert.match(render('reminder_created', { delayMinutes: 5 }), /5/);
  assert.match(render('reminder_list', { tasks: [] }), /没有/);
  assert.match(render('reminder_list', { tasks: [{ taskId: 'r1', summary: 'drink' }] }), /r1/);
  assert.match(render('reminder_cancelled', { taskId: 'r1', cancelled: true }), /撤/);
  assert.match(render('reminder_cancelled', { taskId: 'r1', cancelled: false }), /没找到/);
  assert.match(render('reminder_due', { text: 'drink' }), /drink/);
  assert.match(render('subscription_created', { sourceType: 'rss', target: 'news', intervalMinutes: 10 }), /news/);
  assert.match(render('subscription_list', { tasks: [] }), /没有/);
  assert.match(render('subscription_list', { tasks: [{ taskId: 's1', sourceType: 'rss', target: 'news' }] }), /s1/);
  assert.match(render('subscription_cancelled', { taskId: 's1', cancelled: true }), /停/);
  assert.match(render('subscription_cancelled', { taskId: 's1', cancelled: false }), /没找到/);
  assert.match(render('subscription_update', { summary: 'updated', actionSuggestion: 'check' }), /check/);
});

test('formatter covers meme, knowledge, schedule, welcome, and output helpers', () => {
  assert.match(render('meme_search', { count: 2 }), /2/);
  assert.match(render('meme_search', { count: 0 }, { summary: 'none' }), /none/);
  assert.match(render('meme_optout', {}, { summary: 'opted' }), /opted/);
  assert.match(render('meme_collect', { action: 'collect' }), /素材/);
  assert.match(render('meme_retrieve', { action: 'send-existing' }), /合适/);
  assert.match(render('meme_generate', { action: 'generate-quote' }), /梗图/);
  assert.match(render('meme_generate', { action: 'idle' }, { summary: 'held' }), /held/);
  assert.match(render('knowledge_lookup', { documents: [] }), /可靠依据/);
  assert.match(render('knowledge_lookup', {}, { summary: 'facts' }), /facts/);
  assert.match(render('knowledge_lookup', {}, {}, { specialUser: true }), /最相关/);
  assert.match(render('schedule_note', { text: 'meeting' }), /meeting/);
  assert.match(render('schedule_note', { text: 'meeting' }, {}, { specialUser: true }), /不会让/);
  assert.equal(render('automation_welcome', { customMessage: 'welcome!' }), 'welcome!');
  assert.match(render('automation_welcome', { username: 'Alice' }), /Alice/);

  const outputs = normalizeFormatterOutputs({ payload: { image: 'one', images: ['two', 'three'] } }, 'text');
  assert.deepEqual(outputs, [
    { type: 'text', text: 'text' },
    { type: 'image', image: 'one' },
    { type: 'image', image: 'two' },
    { type: 'image', image: 'three' },
  ]);
  assert.equal(normalizeFormatterOutputs({}, '').length, 0);
  assert.equal(summarizeToolPayload({ tool: 'meme_collect', payload: { tags: ['a', 'b'] } }), '梗图素材可用，标签：a / b');
  assert.match(summarizeToolPayload({ tool: 'meme_retrieve', payload: { assetId: 'asset-1' } }), /asset-1/);
  assert.match(summarizeToolPayload({ tool: 'group_report', payload: { totalMessages: 4, activeUsers: 2 } }), /4/);
  assert.equal(summarizeToolPayload({ summary: 'fallback' }), 'fallback');
  assert.deepEqual(buildStructuredToolResult({ tool: 'custom', payload: { ok: true } }).payload, { ok: true });
});

test('formatter exceptional replies choose permission, timeout, empty, knowledge, and error branches', () => {
  assert.match(render('debug_why', {}, { safetyFlags: ['permission-denied'] }, { specialUser: { addressUserAs: '你' } }), /权限/);
  assert.match(render('tool', {}, { safetyFlags: ['timeout'], error: 'timed out' }), /卡住/);
  assert.match(render('knowledge_lookup', { documents: [] }, { safetyFlags: ['knowledge-empty'] }), /可靠依据/);
  assert.match(render('tool', { items: [] }, { safetyFlags: ['tool-empty'] }), /没有拿到/);
  assert.match(render('tool', {}, { status: 'error', error: 'broken' }), /broken/);
  assert.equal(formatToolResultAsYuno(null), '好，之后按这个来。');
});
