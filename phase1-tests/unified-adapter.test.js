import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnebotMessageEvent } from '../src/adapters/onebot-event.js';

test('validateOnebotMessageEvent normalizes group payloads into unified events', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'message',
    message_type: 'group',
    group_id: 12345,
    user_id: 10001,
    self_id: 20002,
    message_id: 888,
    time: 1234567890,
    raw_message: '[CQ:at,qq=20002] 你好 [CQ:image,file=abc.png]',
    sender: { card: 'Alice' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.platform, 'qq');
  assert.equal(result.value.chatType, 'group');
  assert.equal(result.value.chatId, '12345');
  assert.equal(result.value.userId, '10001');
  assert.equal(result.value.userName, 'Alice');
  assert.equal(result.value.messageId, '888');
  assert.equal(result.value.mentionsBot, true);
  assert.equal(result.value.attachments.length, 1);
  assert.equal(result.value.attachments[0].type, 'image');
});

test('validateOnebotMessageEvent detects group mentions from structured message segments', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'message',
    message_type: 'group',
    group_id: 54321,
    user_id: 10002,
    self_id: 20002,
    raw_message: '你好',
    message: [
      { type: 'at', data: { qq: '20002' } },
      { type: 'text', data: { text: '你好' } },
      { type: 'image', data: { file: 'photo.png' } },
    ],
    sender: { card: 'Eve' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.chatType, 'group');
  assert.equal(result.value.mentionsBot, true);
  assert.equal(result.value.attachments.length, 1);
  assert.equal(result.value.attachments[0].type, 'image');
});

test('validateOnebotMessageEvent normalizes private payloads into unified events', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'message',
    message_type: 'private',
    user_id: 10001,
    raw_message: '在吗',
    sender: { nickname: 'Bob' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.chatType, 'private');
  assert.equal(result.value.chatId, '10001');
  assert.equal(result.value.userName, 'Bob');
  assert.equal(result.value.mentionsBot, false);
});

test('validateOnebotMessageEvent accepts private friend payloads with sender user id fallback', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'message',
    message_type: 'friend',
    raw_message: '在吗',
    sender: { user_id: 10086, nickname: 'Carol' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.chatType, 'private');
  assert.equal(result.value.chatId, '10086');
  assert.equal(result.value.userId, '10086');
  assert.equal(result.value.userName, 'Carol');
});

test('validateOnebotMessageEvent infers private message type when message_type is missing', () => {
  const result = validateOnebotMessageEvent({
    post_type: 'message',
    raw_message: 'hello',
    sender: { user_id: 23333, nickname: 'Dora' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.chatType, 'private');
  assert.equal(result.value.chatId, '23333');
  assert.equal(result.value.userId, '23333');
});
