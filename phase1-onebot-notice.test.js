import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnebotMessageEvent } from './src/adapters/onebot-event.js';

test('onebot adapter converts group increase notice into a welcome event', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'notice',
    notice_type: 'group_increase',
    self_id: '999',
    user_id: '10001',
    group_id: '20001',
    time: Date.now(),
    sender: { nickname: 'Alice' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.chatType, 'group');
  assert.equal(result.value.text, '/welcome');
  assert.equal(result.value.source.noticeType, 'group_increase');
});
