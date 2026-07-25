import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImageMessage,
  sendReplyWithDeps,
  sendStructuredReplyWithDeps,
  sendVoiceWithDeps,
} from './src/sender.js';

test('sender normalizes supported image forms and rejects empty forms', () => {
  assert.deepEqual(normalizeImageMessage('https://example.invalid/a.png'), { file: 'https://example.invalid/a.png' });
  assert.deepEqual(normalizeImageMessage({ file: 'file:///a.png' }), { file: 'file:///a.png' });
  assert.deepEqual(normalizeImageMessage({ path: '/tmp/a.png' }), { path: '/tmp/a.png' });
  assert.deepEqual(normalizeImageMessage({ url: 'https://example.invalid/b.png' }), { url: 'https://example.invalid/b.png' });
  assert.deepEqual(normalizeImageMessage({ base64: 'YWJj' }), { base64: 'YWJj' });
  assert.equal(normalizeImageMessage(null), null);
  assert.equal(normalizeImageMessage({}), null);
});

test('sender delegates private and group text to the runtime delivery adapter', async () => {
  const calls = [];
  const deliveryAdapter = {
    sendReply: async (target, text) => calls.push({ target, text }),
  };

  await sendReplyWithDeps({ platform: 'QQ', chatType: 'private', chatId: '10001' }, 'hello', { deliveryAdapter });
  await sendReplyWithDeps({ chatType: 'group', chatId: '20002' }, 'world', { deliveryAdapter });

  assert.deepEqual(calls, [
    { target: { platform: 'qq', chatType: 'private', chatId: '10001' }, text: 'hello' },
    { target: { platform: 'qq', chatType: 'group', chatId: '20002' }, text: 'world' },
  ]);
});

test('sender preserves filtered structured output order for the delivery adapter', async () => {
  const requests = [];
  const sent = await sendStructuredReplyWithDeps({ chatType: 'group', chatId: '20002' }, [
    null,
    { type: 'text', text: 'first' },
    { type: 'image', image: { base64: 'aGk=' } },
    { type: 'image', image: {} },
    { type: 'text', text: '' },
    { type: 'text', text: 'last' },
  ], {
    deliveryAdapter: {
      sendStructuredReply: async (target, outputs) => requests.push({ target, outputs }),
    },
  });

  assert.equal(sent, 1);
  assert.deepEqual(requests, [{
    target: { platform: 'qq', chatType: 'group', chatId: '20002' },
    outputs: [
      { type: 'text', text: 'first' },
      { type: 'image', image: { base64: 'aGk=' } },
      { type: 'text', text: 'last' },
    ],
  }]);
});

test('sender does not invoke the adapter for an empty structured reply', async () => {
  let calls = 0;
  const sent = await sendStructuredReplyWithDeps({ chatType: 'group', chatId: '20002' }, [null, { type: 'image', image: {} }], {
    deliveryAdapter: { sendStructuredReply: async () => { calls += 1; } },
  });

  assert.equal(sent, false);
  assert.equal(calls, 0);
});

test('sender delegates voice and fails clearly without a delivery adapter', async () => {
  const voices = [];
  await sendVoiceWithDeps({ chatType: 'private', chatId: '10001' }, Buffer.from('audio'), {
    deliveryAdapter: { sendVoice: async (target, audio) => voices.push({ target, audio }) },
  });
  assert.equal(voices.length, 1);
  assert.equal(voices[0].target.chatType, 'private');

  await assert.rejects(
    () => sendReplyWithDeps({ chatType: 'group', chatId: '20002' }, 'missing adapter'),
    (error) => error.code === 'YUNO_DELIVERY_UNAVAILABLE'
  );
});
