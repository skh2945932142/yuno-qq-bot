import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroupRule,
  evaluateGroupAutomation,
  isWithinQuietHours,
} from './src/group-automation.js';

const baseEvent = {
  platform: 'qq',
  chatType: 'group',
  chatId: 'g1',
  userId: 'u1',
  userName: 'Alice',
  rawText: 'deploy failed',
  text: 'deploy failed',
  timestamp: Date.now(),
  source: { postType: 'message' },
};

test('evaluateGroupAutomation creates keyword alert tool results', async () => {
  const rules = [];
  await createGroupRule({ groupId: 'g1', ruleType: 'keyword_watch', pattern: 'deploy', createdBy: 'admin' }, { rules });

  const result = await evaluateGroupAutomation(baseEvent, { rules });

  assert.equal(result.suppressNormalReply, false);
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0].tool, 'automation_keyword_alert');
});

test('evaluateGroupAutomation suppresses normal reply for blocked users', async () => {
  const rules = [
    {
      ruleId: 'rule-1',
      groupId: 'g1',
      ruleType: 'blocked_user',
      enabled: true,
      pattern: 'u1',
      config: {},
    },
  ];

  const result = await evaluateGroupAutomation(baseEvent, { rules });
  assert.equal(result.suppressNormalReply, true);
  assert.equal(result.toolResults.length, 0);
});

test('evaluateGroupAutomation creates welcome messages for group increase notice', async () => {
  const rules = [
    {
      ruleId: 'rule-2',
      groupId: 'g1',
      ruleType: 'welcome',
      enabled: true,
      pattern: '',
      config: { message: 'Welcome aboard.' },
    },
  ];

  const result = await evaluateGroupAutomation({
    ...baseEvent,
    rawText: '[group_increase]',
    text: '/welcome',
    source: { postType: 'notice', noticeType: 'group_increase' },
  }, { rules });

  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0].tool, 'automation_welcome');
});

test('isWithinQuietHours respects cross-midnight ranges', () => {
  const rules = [{
    groupId: 'g1',
    ruleType: 'quiet_hours',
    enabled: true,
    config: { startHour: 23, endHour: 7 },
  }];

  assert.equal(isWithinQuietHours('g1', new Date('2026-03-27T23:30:00+08:00'), rules), true);
  assert.equal(isWithinQuietHours('g1', new Date('2026-03-27T09:00:00+08:00'), rules), false);
});
