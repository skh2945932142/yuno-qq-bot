import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  buildKoishiMongoConfig,
  buildOneBotConfig,
  createKoishiApplication,
  describeBotStates,
  requireKoishiConfig,
  isConfiguredBotOnline,
} from './src/koishi-app.js';

const require = createRequire(import.meta.url);

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

test('Koishi readiness reports non-sensitive bot state diagnostics', () => {
  assert.deepEqual(describeBotStates([
    { selfId: '10000', platform: 'onebot', status: 2 },
  ]), [{
    selfId: '10000', platform: 'onebot', status: 2, statusName: 'CONNECT',
  }]);
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
  assert.equal(ctx.config.prefix, '/');
  assert.equal(ctx.config.prefixMode, 'strict');
});


test('the pinned Console Client bundle starts with the installed Console plugin', async () => {
  const { Context } = require('koishi');
  const Server = require('@koishijs/plugin-server').default;
  const Http = require('@koishijs/plugin-http').default;
  const Console = require('@koishijs/plugin-console').default;
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'yuno-console-test-'));
  const ctx = new Context({ baseDir });
  ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
  ctx.plugin(Http, {});
  ctx.plugin(Console, { cacheDir: path.join(baseDir, 'vite-cache') });

  try {
    await ctx.start();
    assert.ok(ctx.console);
  } finally {
    await ctx.stop();
    await rm(baseDir, { force: true, recursive: true });
  }
});

test('game-mini rejects active startup when the required Koishi Console service is disabled', () => {
  assert.throws(
    () => requireKoishiConfig({
      selfQq: '10000',
      onebotEndpoint: 'ws://llbot:3000',
      onebotToken: 'llbot-token',
      koishiMongoUri: 'mongodb://mongo:27017/koishi',
      koishiConsoleEnabled: false,
      gameMiniEnabled: true,
    }),
    /GAME_MINI_REQUIRES_KOISHI_CONSOLE/
  );
});

test('active mode installs the source-controlled game-mini plugin with offline-only settings', () => {
  let installCount = 0;
  let installedConfig;
  createKoishiApplication({
    mode: 'active',
    gameMiniPlugin: (_ctx, pluginConfig) => {
      installCount += 1;
      installedConfig = pluginConfig;
    },
    config: {
      selfQq: '10000',
      onebotTransport: 'ws',
      onebotEndpoint: 'ws://llbot:3000',
      onebotToken: 'llbot-token',
      koishiMongoUri: 'mongodb://mongo:27017/koishi',
      koishiPort: 5140,
      koishiConsoleEnabled: true,
      koishiConsoleAdmin: 'admin',
      koishiConsolePassword: 'password',
      enableMetrics: false,
      metricsPath: '/metrics',
      metricsAuthToken: '',
      yunoPluginMode: 'active',
      gameMiniEnabled: true,
    },
  });

  assert.equal(installCount, 1);
  assert.equal(installedConfig.enableNumberGuess, true);
  assert.equal(installedConfig.enableCalc24, true);
  assert.equal(installedConfig.enableTurtleSoup, false);
  assert.equal(installedConfig.rank.enableCommand, false);
});


test('the pinned game-mini package and Console Client can be registered together', () => {
  const gameMiniPlugin = require('koishi-plugin-game-mini');
  assert.ok(require.resolve('@koishijs/client/package.json'));

  const ctx = createKoishiApplication({
    mode: 'active',
    config: {
      selfQq: '10000',
      onebotTransport: 'ws',
      onebotEndpoint: 'ws://llbot:3000',
      onebotToken: 'llbot-token',
      koishiMongoUri: 'mongodb://mongo:27017/koishi',
      koishiPort: 5140,
      koishiConsoleEnabled: true,
      koishiConsoleAdmin: 'admin',
      koishiConsolePassword: 'password',
      enableMetrics: false,
      metricsPath: '/metrics',
      metricsAuthToken: '',
      yunoPluginMode: 'active',
      gameMiniEnabled: true,
    },
  });

  assert.equal(ctx.registry.has(gameMiniPlugin), true);
});

test('shadow mode never installs game-mini even when the feature flag is enabled', () => {
  let installCount = 0;
  createKoishiApplication({
    mode: 'shadow',
    gameMiniPlugin: () => { installCount += 1; },
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
      gameMiniEnabled: true,
    },
  });

  assert.equal(installCount, 0);
});
