import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroupRule,
  evaluateGroupAutomation,
  findMatchingGroupRules,
  isWithinQuietHours,
  listGroupRules,
  markRuleTriggered,
  removeGroupRule,
} from './src/group-automation.js';

test('group automation covers duplicate/list/remove/trigger branches with in-memory rules', async () => {
  const rules = [];
  const first = await createGroupRule({ ruleId: 'r1', groupId: 'g1', ruleType: 'keyword_watch', pattern: 'deploy' }, { rules });
  const duplicate = await createGroupRule({ ruleId: 'r2', groupId: 'g1', ruleType: 'keyword_watch', pattern: 'deploy' }, { rules });
  assert.equal(first.ruleId, duplicate.ruleId);
  assert.equal((await listGroupRules('g1', { ruleType: 'keyword_watch', enabled: true }, { rules })).length, 1);
  assert.equal(await removeGroupRule('missing', { rules }), null);
  assert.equal((await markRuleTriggered('r1', new Date('2026-07-23T10:00:00Z'), { rules })).ruleId, 'r1');
  assert.equal(await markRuleTriggered('missing', new Date(), { rules }), null);
  assert.equal((await removeGroupRule('r1', { rules })).ruleId, 'r1');
});

test('group automation matches blocked, welcome, keyword, quiet, and unrelated rules', async () => {
  const rules = [
    { ruleId: 'keyword', groupId: 'g1', ruleType: 'keyword_watch', pattern: 'deploy', enabled: true },
    { ruleId: 'blocked', groupId: 'g1', ruleType: 'blocked_user', pattern: 'u1', enabled: true },
    { ruleId: 'welcome', groupId: 'g1', ruleType: 'welcome', enabled: true, config: { message: 'hi' } },
    { ruleId: 'quiet', groupId: 'g1', ruleType: 'quiet_hours', enabled: true, config: { startHour: 23, endHour: 7 } },
    { ruleId: 'disabled', groupId: 'g1', ruleType: 'keyword_watch', pattern: 'deploy', enabled: false },
  ];
  const event = {
    chatType: 'group', chatId: 'g1', userId: 'u1', userName: 'Alice', rawText: '[CQ:at,qq=1] deploy',
    timestamp: new Date('2026-07-23T23:30:00'), source: { noticeType: 'group_increase' },
  };
  const matches = await findMatchingGroupRules(event, { rules });
  assert.equal(matches.length, 4);
  const result = await evaluateGroupAutomation(event, { rules });
  assert.equal(result.suppressNormalReply, true);
  assert.equal(result.toolResults.length, 2);

  const privateResult = await evaluateGroupAutomation({ ...event, chatType: 'private' }, { rules });
  assert.deepEqual(privateResult, { suppressNormalReply: false, toolResults: [], matchedRules: [] });
  assert.deepEqual(await findMatchingGroupRules({ chatId: '' }, { rules }), []);
});

test('group automation quiet-hours handles same-hour, forward, reverse, and disabled ranges', () => {
  const date = new Date('2026-07-23T10:30:00');
  assert.equal(isWithinQuietHours('g1', date, [{ groupId: 'g1', ruleType: 'quiet_hours', enabled: true, config: { startHour: 10, endHour: 10 } }]), true);
  assert.equal(isWithinQuietHours('g1', date, [{ groupId: 'g1', ruleType: 'quiet_hours', enabled: true, config: { startHour: 9, endHour: 11 } }]), true);
  assert.equal(isWithinQuietHours('g1', date, [{ groupId: 'g1', ruleType: 'quiet_hours', enabled: true, config: { startHour: 23, endHour: 7 } }]), false);
  assert.equal(isWithinQuietHours('g1', date, [{ groupId: 'other', ruleType: 'quiet_hours', enabled: true, config: { startHour: 0, endHour: 23 } }]), false);
  assert.equal(isWithinQuietHours('g1', date, [{ groupId: 'g1', ruleType: 'quiet_hours', enabled: false, config: { startHour: 0, endHour: 23 } }]), false);
});
