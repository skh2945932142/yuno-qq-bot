import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  buildKoishiMongoConfig,
  buildOneBotConfig,
  createKoishiApplication,
  requireKoishiConfig,
  isConfiguredBotOnline,
  verifyOneBotSignature,
} from './src/koishi-app.js';

test('Koishi Mongo config derives the database name from the URI', () => {
  assert.deepEqual(buildKoishiMongoConfig('mongodb://mongo:27017/koishi'), {
    uri: 'mongodb://mongo:27017/koishi',
    database: 'koishi',
  });
});

test('Koishi OneBot HTTP config uses NapCat access_token query authentication', () => {
  const onebotConfig = buildOneBotConfig({
    selfQq: '10000',
    onebotEndpoint: 'http://napcat:3000',
    onebotToken: 'napcat-token',
    onebotSecret: 'event-secret',
  });

  assert.deepEqual(onebotConfig, {
    selfId: '10000',
    protocol: 'http',
    endpoint: 'http://napcat:3000',
    token: 'napcat-token',
    path: '/onebot',
    secret: 'event-secret',
    params: { access_token: 'napcat-token' },
  });
  assert.equal('params' in buildOneBotConfig({
    selfQq: '10000',
    onebotEndpoint: 'http://napcat:3000',
    onebotToken: '',
    onebotSecret: '',
  }), false);
});

test('Koishi OneBot ingress validates the NapCat HMAC over raw request bytes', () => {
  const body = { post_type: 'message', self_id: 10000, raw_message: 'hello' };
  const rawBody = Buffer.from(JSON.stringify(body));
  const secret = 'event-secret';
  const signature = `sha1=${createHmac('sha1', secret).update(rawBody).digest('hex')}`;

  assert.equal(verifyOneBotSignature({ body, rawBody, signature, secret }), true);
  assert.equal(verifyOneBotSignature({ body, rawBody, signature: 'sha1=invalid', secret }), false);
  assert.equal(verifyOneBotSignature({ body, rawBody: Buffer.from('{"changed":true}'), signature, secret }), false);
});

test('Koishi readiness recognizes the Satori online status enum', () => {
  assert.equal(isConfiguredBotOnline([{ selfId: '10000', status: 1 }], '10000'), true);
  assert.equal(isConfiguredBotOnline([{ selfId: '10000', status: 0 }], '10000'), false);
  assert.equal(isConfiguredBotOnline([{ selfId: '99999', status: 1 }], '10000'), false);
});

test('Koishi configuration requires the OneBot bot and console credentials when enabled', () => {
  assert.throws(
    () => requireKoishiConfig({ selfQq: '', onebotEndpoint: '', koishiMongoUri: '', koishiConsoleEnabled: false }),
    /SELF_QQ, ONEBOT_ENDPOINT, KOISHI_MONGODB_URI/
  );
  assert.throws(
    () => requireKoishiConfig({ selfQq: '10000', onebotEndpoint: 'http://onebot:3001', koishiMongoUri: 'mongodb://mongo:27017/koishi', koishiConsoleEnabled: true }),
    /KOISHI_CONSOLE_ADMIN, KOISHI_CONSOLE_PASSWORD/
  );
});

test('Koishi application constructs the fixed server, database, OneBot, and Yuno plugin stack', () => {
  const ctx = createKoishiApplication({
    mode: 'shadow',
    config: {
      selfQq: '10000',
      onebotEndpoint: 'http://onebot:3001',
      onebotToken: '',
      onebotSecret: '',
      koishiMongoUri: 'mongodb://mongo:27017/koishi',
      koishiPort: 5140,
      koishiConsoleEnabled: false,
      enableMetrics: false,
      metricsPath: '/metrics',
      metricsAuthToken: '',
      yunoPluginMode: 'shadow',
    },
  });

  assert.equal(Array.isArray(ctx.bots), true);
  assert.ok(ctx.server);
});
