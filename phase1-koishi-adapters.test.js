import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKoishiDeliveryAdapter,
  createKoishiProtocolAdapter,
  isBotOnline,
  renderOutputs,
  resolveBot,
  resolveImageSource,
  toChannelId,
} from './src/koishi-adapters.js';

function createContext() {
  const sent = [];
  const primary = {
    platform: 'onebot',
    selfId: '10000',
    status: 'online',
    async sendMessage(channelId, content) {
      sent.push({ bot: 'primary', channelId, content });
    },
    internal: {
      async _request(action, payload) {
        if (action === 'bad_action') return { retcode: 100, data: null };
        return { retcode: 0, data: { action, payload } };
      },
    },
  };
  const secondary = {
    platform: 'onebot',
    selfId: '99999',
    status: 'online',
    async sendMessage(channelId, content) {
      sent.push({ bot: 'secondary', channelId, content });
    },
  };
  return { context: { bots: [secondary, primary] }, sent };
}

test('Koishi delivery selects SELF_QQ and maps group/private targets', async () => {
  const { context, sent } = createContext();
  const adapter = createKoishiDeliveryAdapter(context, { selfId: '10000' });

  await adapter.sendReply({ platform: 'qq', chatType: 'group', chatId: '30000' }, 'group text');
  await adapter.sendStructuredReply({ platform: 'qq', chatType: 'private', chatId: '20000' }, [
    { type: 'text', text: 'before' },
    { type: 'image', image: { base64: 'aGk=' } },
    { type: 'text', text: 'after' },
  ]);

  assert.deepEqual(sent.map((item) => [item.bot, item.channelId]), [
    ['primary', '30000'],
    ['primary', 'private:20000'],
  ]);
  assert.match(sent[1].content, /before/);
  assert.match(sent[1].content, /data:image\/png;base64,aGk=/);
  assert.match(sent[1].content, /after/);
});

test('Koishi delivery accepts uppercase and numeric online bot states', async () => {
  assert.equal(isBotOnline('ONLINE'), true);
  assert.equal(isBotOnline(1), true);
  assert.equal(isBotOnline('offline'), false);

  for (const status of ['ONLINE', 1]) {
    const sent = [];
    const adapter = createKoishiDeliveryAdapter({
      bots: [{
        platform: 'onebot',
        selfId: '10000',
        status,
        async sendMessage(channelId, content) {
          sent.push({ channelId, content });
        },
      }],
    }, { selfId: '10000' });

    await adapter.sendReply({ platform: 'qq', chatType: 'private', chatId: '20000' }, 'ok');
    assert.deepEqual(sent, [{ channelId: 'private:20000', content: 'ok' }]);
  }
});

test('Koishi delivery exposes bot availability and OneBot send failures as unified errors', async () => {
  const unavailable = createKoishiDeliveryAdapter({ bots: [] }, { selfId: '10000' });
  await assert.rejects(
    () => unavailable.sendReply({ platform: 'qq', chatType: 'group', chatId: '30000' }, 'x'),
    (error) => error.code === 'YUNO_DELIVERY_FAILED' && error.cause.code === 'KOISHI_CONFIGURED_BOT_UNAVAILABLE'
  );

  const offline = createKoishiDeliveryAdapter({
    bots: [{ platform: 'onebot', selfId: '10000', status: 'offline', sendMessage: async () => {} }],
  }, { selfId: '10000' });
  await assert.rejects(
    () => offline.sendReply({ platform: 'qq', chatType: 'group', chatId: '30000' }, 'x'),
    (error) => error.code === 'YUNO_DELIVERY_FAILED' && error.cause.code === 'KOISHI_BOT_OFFLINE'
  );
});

test('Koishi protocol adapter calls OneBot internal actions and surfaces retcode failures', async () => {
  const { context } = createContext();
  const adapter = createKoishiProtocolAdapter(context, { selfId: '10000' });

  assert.deepEqual(
    await adapter.callAction('fetch_custom_face', { count: 48 }),
    { action: 'fetch_custom_face', payload: { count: 48 } }
  );
  await assert.rejects(
    () => adapter.callAction('bad_action', {}),
    (error) => error.code === 'YUNO_PROTOCOL_ACTION_FAILED' && error.cause.code === 100
  );
});


test('Koishi adapter helpers cover image inputs and internal protocol availability errors', async () => {
  assert.equal(resolveImageSource('https://example.invalid/a.png'), 'https://example.invalid/a.png');
  assert.equal(resolveImageSource({ file: 'file:///a.png' }), 'file:///a.png');
  assert.equal(resolveImageSource({ path: '/tmp/a.png' }), '/tmp/a.png');
  assert.equal(resolveImageSource({ url: 'https://example.invalid/a.png' }), 'https://example.invalid/a.png');
  assert.equal(resolveImageSource({}), '');
  assert.equal(toChannelId({ chatType: 'group', chatId: '30000' }), '30000');
  assert.equal(renderOutputs([{ type: 'text', text: '' }, { type: 'unknown' }]), '');
  assert.throws(() => resolveBot({ bots: [{ platform: 'other', selfId: '1' }] }, { selfId: '10000' }), /KOISHI_CONFIGURED_BOT_UNAVAILABLE/);

  const adapter = createKoishiProtocolAdapter({
    bots: [{ platform: 'onebot', selfId: '10000', status: 'online', internal: {} }],
  }, { selfId: '10000' });
  await assert.rejects(
    () => adapter.callAction('fetch_custom_face', {}),
    (error) => error.code === 'KOISHI_ONEBOT_INTERNAL_UNAVAILABLE'
  );
});
