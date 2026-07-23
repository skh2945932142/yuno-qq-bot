import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNapcatTargetPayload,
  normalizeImageMessage,
  sendReplyWithDeps,
  sendStructuredReplyWithDeps,
} from './src/sender.js';

test('sender builds private and group NapCat payloads', () => {
  assert.deepEqual(buildNapcatTargetPayload({ platform: 'QQ', chatType: 'private', chatId: '10001' }, []), {
    action: 'send_private_msg',
    payload: { user_id: 10001, message: [] },
    target: { platform: 'qq', chatType: 'private', chatId: '10001' },
  });
  assert.deepEqual(buildNapcatTargetPayload({ chatType: 'group', chatId: '20002' }, []), {
    action: 'send_group_msg',
    payload: { group_id: 20002, message: [] },
    target: { platform: 'qq', chatType: 'group', chatId: '20002' },
  });
});

test('sender normalizes supported image forms and rejects empty forms', () => {
  assert.deepEqual(normalizeImageMessage('https://example.invalid/a.png'), {
    type: 'image', data: { file: 'https://example.invalid/a.png' },
  });
  assert.deepEqual(normalizeImageMessage({ file: 'file:///a.png' }), {
    type: 'image', data: { file: 'file:///a.png' },
  });
  assert.deepEqual(normalizeImageMessage({ path: '/tmp/a.png' }), {
    type: 'image', data: { file: '/tmp/a.png' },
  });
  assert.deepEqual(normalizeImageMessage({ url: 'https://example.invalid/b.png' }), {
    type: 'image', data: { file: 'https://example.invalid/b.png' },
  });
  assert.deepEqual(normalizeImageMessage({ base64: 'YWJj' }), {
    type: 'image', data: { file: 'base64://YWJj' },
  });
  assert.equal(normalizeImageMessage(null), null);
  assert.equal(normalizeImageMessage({}), null);
});

test('sendReplyWithDeps supports action-payload and payload-only fakes', async () => {
  const calls = [];
  await sendReplyWithDeps({ chatType: 'private', chatId: '10001' }, 'hello', {
    postNapcat: async (action, payload, label) => calls.push([action, payload, label]),
  });
  await sendReplyWithDeps({ chatType: 'group', chatId: '20002' }, 'world', {
    postNapcat: async (payload) => calls.push([payload]),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'send_private_msg');
  assert.deepEqual(calls[0][1], { user_id: 10001, message: [{ type: 'text', data: { text: 'hello' } }] });
  assert.equal(calls[1][0].group_id, 20002);
  assert.equal(calls[1][0].message[0].data.text, 'world');
});

test('sendStructuredReplyWithDeps preserves text and image order', async () => {
  const requests = [];
  const sent = await sendStructuredReplyWithDeps({ chatType: 'group', chatId: '20002' }, [
    null,
    { type: 'text', text: 'first' },
    { type: 'image', image: { base64: 'aGk=' } },
    { type: 'image', image: {} },
    { type: 'text', text: '' },
    { type: 'text', text: 'last' },
  ], {
    postNapcat: async (payload) => requests.push(payload),
  });

  assert.equal(sent, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].message, [
    { type: 'text', data: { text: 'first' } },
    { type: 'image', data: { file: 'base64://aGk=' } },
    { type: 'text', data: { text: 'last' } },
  ]);
});

test('sendStructuredReplyWithDeps does not post an empty structured reply', async () => {
  let postCount = 0;
  const sent = await sendStructuredReplyWithDeps({ chatType: 'group', chatId: '20002' }, [null, { type: 'image', image: {} }], {
    postNapcat: async () => { postCount += 1; },
  });
  assert.equal(sent, false);
  assert.equal(postCount, 0);
});
