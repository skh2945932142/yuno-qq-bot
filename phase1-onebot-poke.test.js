import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnebotMessageEvent } from './src/adapters/onebot-event.js';
import { shouldRespondToEvent } from './src/message-workflow.js';

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

test('onebot adapter marks CQ at messages as bot mentions and keeps self id', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'message',
    message_type: 'group',
    raw_message: '[CQ:at,qq=3847566155] 你好',
    self_id: '3847566155',
    user_id: '10001',
    group_id: '20001',
    message_id: 'msg-at-1',
    time: Date.now(),
    sender: { nickname: 'Alice' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.chatType, 'group');
  assert.equal(result.value.chatId, '20001');
  assert.equal(result.value.mentionsBot, true);
  assert.equal(result.value.selfId, '3847566155');
});

test('shouldRespondToEvent allows group CQ at messages from normalized onebot payloads', async () => {
  const validation = validateOnebotMessageEvent({
    post_type: 'message',
    message_type: 'group',
    raw_message: '[CQ:at,qq=3847566155] help me please',
    self_id: '3847566155',
    user_id: '10001',
    group_id: '20001',
    message_id: 'msg-at-2',
    time: Date.now(),
    sender: { nickname: 'Alice' },
  });

  assert.equal(validation.ok, true);

  const decision = await shouldRespondToEvent(validation.value);
  assert.equal(decision.analysis.shouldRespond, true);
  assert.equal(decision.analysis.reason, 'basic-direct-mention-pass');
});
