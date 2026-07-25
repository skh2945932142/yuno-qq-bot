import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { createYunoKoishiPlugin } from './koishi-yuno-plugin.js';
import { getYunoRuntimeStatus } from './yuno-runtime.js';

const require = createRequire(import.meta.url);
const { Context } = require('koishi');
const Server = require('@koishijs/plugin-server').default;
const Http = require('@koishijs/plugin-http').default;
const Console = require('@koishijs/plugin-console').default;
const Auth = require('@koishijs/plugin-auth').default;
const Mongo = require('@koishijs/plugin-database-mongo').default;
const OneBot = require('koishi-plugin-adapter-onebot').default;

function constantTimeEquals(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireKoishiConfig(runtimeConfig = config) {
  const required = [
    ['SELF_QQ', runtimeConfig.selfQq],
    ['ONEBOT_ENDPOINT', runtimeConfig.onebotEndpoint],
    ['KOISHI_MONGODB_URI', runtimeConfig.koishiMongoUri],
  ];
  if (runtimeConfig.koishiConsoleEnabled) {
    required.push(['KOISHI_CONSOLE_ADMIN', runtimeConfig.koishiConsoleAdmin]);
    required.push(['KOISHI_CONSOLE_PASSWORD', runtimeConfig.koishiConsolePassword]);
  }
  if (runtimeConfig.enableMetrics) {
    required.push(['METRICS_AUTH_TOKEN', runtimeConfig.metricsAuthToken]);
  }
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Missing required Koishi environment variables: ${missing.join(', ')}`);
  }
}

function buildKoishiMongoConfig(uri) {
  const parsed = new URL(uri);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'koishi';
  return { uri, database };
}

function buildOneBotConfig(runtimeConfig = config) {
  const onebotConfig = {
    selfId: runtimeConfig.selfQq,
    protocol: 'http',
    endpoint: runtimeConfig.onebotEndpoint,
    token: runtimeConfig.onebotToken,
    path: '/onebot',
    secret: runtimeConfig.onebotSecret || undefined,
  };

  // NapCat accepts Bearer authentication or an access_token query parameter,
  // while Koishi's HTTP adapter sends its token with the legacy Token scheme.
  if (runtimeConfig.onebotToken) {
    onebotConfig.params = { access_token: runtimeConfig.onebotToken };
  }
  return onebotConfig;
}

function installOperationalRoutes(ctx, runtimeConfig = config) {
  ctx.server.get('/health', (koa) => {
    koa.body = 'Yuno online';
  });

  ctx.server.get('/ready', (koa) => {
    const status = getYunoRuntimeStatus();
    const botOnline = ctx.bots.some((bot) => String(bot.selfId) === runtimeConfig.selfQq && bot.status === 'online');
    const ready = status.ready && botOnline;
    koa.status = ready ? 200 : 503;
    koa.body = {
      ...status,
      bot: botOnline,
      ready,
    };
  });

  ctx.server.get(runtimeConfig.metricsPath, (koa) => {
    if (!runtimeConfig.enableMetrics) {
      koa.status = 404;
      koa.body = 'metrics disabled';
      return;
    }
    if (!constantTimeEquals(koa.headers['x-yuno-metrics-token'], runtimeConfig.metricsAuthToken)) {
      koa.status = 401;
      koa.body = 'unauthorized';
      return;
    }
    koa.type = 'text/plain; version=0.0.4';
    koa.body = metrics.snapshot();
  });
}

export function createKoishiApplication(options = {}) {
  const runtimeConfig = { ...config, ...(options.config || {}) };
  requireKoishiConfig(runtimeConfig);

  const ctx = new Context();
  ctx.plugin(Server, {
    host: options.host || '0.0.0.0',
    port: runtimeConfig.koishiPort,
  });
  ctx.plugin(Http, {});
  ctx.plugin(Mongo, buildKoishiMongoConfig(runtimeConfig.koishiMongoUri));

  if (runtimeConfig.koishiConsoleEnabled) {
    ctx.plugin(Console, {});
    ctx.plugin(Auth, {
      admin: {
        enabled: true,
        username: runtimeConfig.koishiConsoleAdmin,
        password: runtimeConfig.koishiConsolePassword,
      },
    });
  }

  ctx.plugin(OneBot, buildOneBotConfig(runtimeConfig));
  installOperationalRoutes(ctx, runtimeConfig);
  ctx.plugin(createYunoKoishiPlugin({
    config: runtimeConfig,
    mode: options.mode || runtimeConfig.yunoPluginMode,
  }));
  return ctx;
}

export async function startKoishiApplication(options = {}) {
  const ctx = createKoishiApplication(options);
  await ctx.start();
  logger.info('koishi', 'Koishi and Yuno application started', {
    port: ({ ...config, ...(options.config || {}) }).koishiPort,
    mode: options.mode || ({ ...config, ...(options.config || {}) }).yunoPluginMode,
  });
  return ctx;
}

export async function stopKoishiApplication(ctx) {
  if (ctx) {
    await ctx.stop();
  }
}

export {
  buildKoishiMongoConfig,
  buildOneBotConfig,
  installOperationalRoutes,
  requireKoishiConfig,
};
