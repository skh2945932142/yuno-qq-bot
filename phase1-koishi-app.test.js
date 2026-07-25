import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKoishiMongoConfig,
  buildOneBotConfig,
  createKoishiApplication,
  requireKoishiConfig,
  isConfiguredBotOnline,
} from './src/koishi-app.js';

test('Koishi Mongo config derives the database name from the URI', () => {
  assert.deepEqual(buildKoishiMongoConfig('mongodb://mongo:27017/koishi'), {
    uri: 'mongodb://mongo:27017/koishi',
    database: 'koishi',
  });
});

test('Koishi OneBot config uses the LLBot positive WebSocket transport', () => {
  const onebotConfig = buildOneBotConfig({
    selfQq: '10000',
    onebotTransport: 'ws',
    onebotEndpoint: 'ws://llbot:3000',
    onebotToken: 'llbot-token',
  });
  assert.deepEqual(onebotConfig, {
    selfId: '10000',
    protocol: 'ws',
    endpoint: 'ws://llbot:3000',
    token: 'llbot-token',
  });
});

test('Koishi readiness recognizes the Satori online status enum', () => {
  assert.equal(isConfiguredBotOnline([{ selfId: '10000', status: 1 }], '10000'), true);
  assert.equal(isConfiguredBotOnline([{ selfId: '10000', status: 'online' }], '10000'), true);
  assert.equal(isConfiguredBotOnline([{ selfId: '10000', status: 0 }], '10000'), false);
  assert.equal(isConfiguredBotOnline([{ selfId: '99999', status: 1 }], '10000'), false);
});

test('Koishi configuration requires the OneBot bot and console credentials when enabled', () => {
  assert.throws(
    () => requireKoishiConfig({ selfQq: '', onebotEndpoint: '', koishiMongoUri: '', koishiConsoleEnabled: false }),
    /SELF_QQ, ONEBOT_ENDPOINT, ONEBOT_TOKEN, KOISHI_MONGODB_URI/
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
      onebotTransport: 'ws',
      onebotEndpoint: 'ws://llbot:3000',
      onebotToken: 'llbot-token',
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
