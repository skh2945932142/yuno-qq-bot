import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnebotMessageEvent } from './src/adapters/onebot-event.js';

test('onebot adapter converts poke notice into a unified trigger event', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'notice',
    notice_type: 'notify',
    sub_type: 'poke',
    self_id: '999',
    user_id: '10001',
    target_id: '999',
    group_id: '20001',
    time: Date.now(),
    sender: { nickname: 'Alice' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.chatType, 'group');
  assert.equal(result.value.mentionsBot, true);
  assert.equal(result.value.text, '/poke');
  assert.equal(result.value.source.noticeType, 'notify');
});
