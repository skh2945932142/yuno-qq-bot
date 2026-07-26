import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptKoishiSession,
  collectAttachments,
  hasAtSelf,
  resolveNoticeText,
  resolveOnebotPayload,
  stripPrivateChannelPrefix,
} from './src/koishi-session-adapter.js';

test('Koishi Session adapter maps group messages, mentions, replies, and attachments', () => {
  const event = adaptKoishiSession({
    type: 'message',
    subtype: 'group',
    selfId: '10000',
    userId: '20000',
    guildId: '30000',
    channelId: '30000',
    messageId: 'm-1',
    timestamp: 1_700_000_000_000,
    content: 'hello <at id="10000"/>',
    elements: [
      { type: 'text', attrs: { content: 'hello ' } },
      { type: 'at', attrs: { id: '10000' } },
      { type: 'img', attrs: { src: 'https://example.invalid/a.png' } },
      { type: 'audio', attrs: { src: 'https://example.invalid/a.silk' } },
      { type: 'video', attrs: { src: 'https://example.invalid/a.mp4' } },
      { type: 'file', attrs: { src: 'https://example.invalid/a.txt' } },
      { type: 'face', attrs: { id: '14' } },
    ],
    quote: {
      messageId: 'quoted-1',
      content: '前面这条 <at id="30001"/> 具体是什么意思？',
      user: { name: 'Bob' },
    },
    author: { name: '昵称', member: { nick: '群名片' } },
    getInternal: () => ({ post_type: 'message', message_type: 'group', time: 1_700_000_000 }),
  });

  assert.equal(event.chatType, 'group');
  assert.equal(event.chatId, '30000');
  assert.equal(event.userName, '群名片');
  assert.equal(event.mentionsBot, true);
  assert.equal(event.replyTo, 'quoted-1');
  assert.equal(event.replyToText, '前面这条 具体是什么意思？');
  assert.equal(event.replyToUserId, '');
  assert.equal(event.replyToUserName, 'Bob');
  assert.equal(event.timestamp, 1_700_000_000_000);
  assert.deepEqual(event.attachments.map((item) => item.type), ['image', 'record', 'video', 'file', 'face']);
  assert.equal(event.source.adapter, 'koishi');
  assert.equal(event.source.transport, 'onebot');
});
test('Koishi Session adapter reads the OneBot payload attached by Satori', () => {
  const onebot = {
    post_type: 'message',
    message_type: 'group',
    group_id: 30000,
    self_id: 10000,
    user_id: 20000,
    message_id: 12345,
    time: 1_700_000_000,
  };
  const event = adaptKoishiSession({
    type: 'message-created',
    subtype: 'group',
    selfId: '10000',
    userId: '20000',
    guildId: '30000',
    channelId: '30000',
    messageId: '12345',
    content: 'live payload',
    onebot,
  });

  assert.equal(resolveOnebotPayload({ onebot }), onebot);
  assert.equal(event.source.postType, 'message');
  assert.equal(event.source.sessionType, 'message-created');
  assert.equal(event.timestamp, 1_700_000_000_000);
});

test('Koishi Session adapter treats a reply to the bot as an explicit mention', () => {
  const event = adaptKoishiSession({
    type: 'message',
    subtype: 'group',
    selfId: '10000',
    userId: '20000',
    guildId: '30000',
    channelId: '30000',
    messageId: 'm-reply',
    content: '为什么？',
    elements: [{ type: 'text', attrs: { content: '为什么？' } }],
    quote: {
      messageId: 'bot-message',
      content: '上一条由乃回复',
      user: { id: '10000', name: '由乃' },
    },
    getInternal: () => ({ post_type: 'message', message_type: 'group', group_id: 30000 }),
  });

  assert.equal(event.mentionsBot, true);
  assert.equal(event.replyToUserId, '10000');
  assert.equal(event.replyToText, '上一条由乃回复');
});

test('Koishi Session adapter removes the private channel prefix', () => {
  const event = adaptKoishiSession({
    type: 'message',
    subtype: 'private',
    isDirect: true,
    selfId: '10000',
    userId: '20000',
    channelId: 'private:20000',
    messageId: 'm-2',
    content: 'ping',
    getInternal: () => ({ post_type: 'message', message_type: 'private', time: 1_700_000_001 }),
  });

  assert.equal(event.chatType, 'private');
  assert.equal(event.chatId, '20000');
  assert.equal(event.timestamp, 1_700_000_001_000);
});

test('Koishi Session adapter maps poke and group-member-added notices', () => {
  const poke = adaptKoishiSession({
    type: 'notice',
    subtype: 'poke',
    selfId: '10000',
    userId: '20000',
    guildId: '30000',
    channelId: '30000',
    getInternal: () => ({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', group_id: 30000 }),
  });
  const welcome = adaptKoishiSession({
    type: 'guild-member-added',
    subtype: 'active',
    selfId: '10000',
    userId: '20000',
    guildId: '30000',
    channelId: '30000',
    getInternal: () => ({ post_type: 'notice', notice_type: 'group_increase', group_id: 30000 }),
  });

  assert.equal(poke.rawText, '/poke');
  assert.equal(poke.source.noticeType, 'notify');
  assert.equal(welcome.rawText, '/welcome');
  assert.equal(welcome.source.noticeType, 'group_increase');
});


test('Koishi Session adapter helpers cover nested elements and absent OneBot metadata', () => {
  assert.deepEqual(collectAttachments([{
    type: 'face',
    attrs: { id: '14' },
    children: [{ type: 'img', attrs: { src: 'https://example.invalid/face.png' } }],
  }]).map((item) => item.type), ['face', 'image']);
  assert.equal(hasAtSelf([{ type: 'p', children: [{ type: 'at', attrs: { qq: '10000' } }] }], '10000'), true);
  assert.equal(hasAtSelf([], ''), false);
  assert.equal(stripPrivateChannelPrefix('private:20000'), '20000');
  assert.equal(stripPrivateChannelPrefix('30000'), '30000');
  assert.equal(resolveNoticeText({ type: 'notice', subtype: 'poke' }, {}), '/poke');
  assert.equal(resolveNoticeText({ type: 'guild-member-added' }, {}), '/welcome');
  assert.deepEqual(resolveOnebotPayload({ internal: { onebot: { post_type: 'message' } } }), { post_type: 'message' });

  const event = adaptKoishiSession({
    type: 'message',
    subtype: 'private',
    isDirect: true,
    userId: '20000',
    channelId: 'private:20000',
    content: 'plain',
    internal: { onebot: { post_type: 'message', message_type: 'private' } },
  });
  assert.equal(event.mentionsBot, false);
  assert.equal(event.timestamp > 0, true);
});
