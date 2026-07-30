import { config } from './config.js';
import { logger } from './logger.js';
import { createKoishiDeliveryAdapter, createKoishiProtocolAdapter } from './koishi-adapters.js';
import { adaptKoishiSession } from './koishi-session-adapter.js';
import {
  getYunoRuntimeStatus,
  initializeYunoRuntime,
  isYunoRuntimeAcceptingMessages,
  shutdownYunoRuntime,
} from './yuno-runtime.js';
import { runYunoConversation } from './yuno-core.js';
import { createMessageAggregator } from './message-aggregator.js';

function isKoishiAdminCommand(session = {}) {
  return /^\s*\/koishi(?:\s|$)/i.test(String(session.content || ''));
}

function isAdmin(session = {}, runtimeConfig = config) {
  return Boolean(runtimeConfig.adminQq)
    && String(session.userId || '') === String(runtimeConfig.adminQq);
}

function isYunoSessionEligible(event = {}) {
  if (event.source?.postType === 'message') return true;
  if (event.source?.sessionType === 'message-created') return true;
  if (event.rawText === '/poke' || event.rawText === '/welcome') return true;
  return false;
}

function formatStatus(status) {
  return [
    `runtime=${status.initialized ? 'ready' : 'starting'}`,
    `db=${status.db ? 'ready' : 'down'}`,
    `queue=${status.queue?.mode || 'disabled'}`,
    `scheduler=${status.scheduler ? 'running' : 'stopped'}`,
    `degraded=${status.degraded ? 'yes' : 'no'}`,
  ].join(' | ');
}

export function createYunoKoishiPlugin(options = {}) {
  const runtimeConfig = options.config || config;
  const mode = String(options.mode || runtimeConfig.yunoPluginMode || 'active').toLowerCase();
  const initializeRuntime = options.initializeYunoRuntime || initializeYunoRuntime;
  const shutdownRuntime = options.shutdownYunoRuntime || shutdownYunoRuntime;
  const runConversation = options.runYunoConversation || runYunoConversation;
  const isRuntimeAccepting = options.isYunoRuntimeAcceptingMessages || isYunoRuntimeAcceptingMessages;
  const runtimeLogger = options.logger || logger;

  return (ctx) => {
    const deliveryAdapter = options.deliveryAdapter || createKoishiDeliveryAdapter(ctx, {
      selfId: runtimeConfig.selfQq,
      logger: runtimeLogger,
    });
    const protocolAdapter = options.protocolAdapter || createKoishiProtocolAdapter(ctx, {
      selfId: runtimeConfig.selfQq,
    });
    let runtime = null;
    let acceptingMessages = false;
    const messageAggregator = options.messageAggregator
      || options.privateMessageAggregator
      || createMessageAggregator({ runtimeConfig });

    // Shadow mode records the Session boundary without invoking any Yuno service.
    if (mode === 'shadow') {
      ctx.on('message', (session) => {
        const event = adaptKoishiSession(session);
        runtimeLogger.info('koishi', 'shadow_session', {
          selfId: event.selfId,
          userId: event.userId,
          chatId: event.chatId,
          messageId: event.messageId,
          chatType: event.chatType,
          sessionType: event.source?.sessionType,
          postType: event.source?.postType,
          messageType: event.source?.messageType,
          attachments: event.attachments.length,
        });
      });
    }

    ctx.on('ready', async () => {
      if (mode === 'shadow') {
        runtimeLogger.info('koishi', 'Yuno plugin started in shadow mode');
        return;
      }
      runtime = await initializeRuntime({
        config: runtimeConfig,
        deliveryAdapter,
        protocolAdapter,
      });
      acceptingMessages = true;
    });

    ctx.middleware(async (session, next) => {
      const event = adaptKoishiSession(session);
      const reservation = event.userId && event.chatId
        && (event.chatType === 'private' || event.chatType === 'group')
        ? messageAggregator.reserve(event)
        : null;

      if (isKoishiAdminCommand(session)) {
        if (!isAdmin(session, runtimeConfig)) {
          await session.send('没有这个管理权限。');
          if (reservation) await messageAggregator.submit(reservation, { accepted: false });
          return '';
        }
        const command = String(session.content || '').trim().split(/\s+/)[1] || 'status';
        if (command === 'status' || command === 'health') {
          await session.send(formatStatus(getYunoRuntimeStatus()));
        } else {
          await session.send('可用命令：/koishi status');
        }
        if (reservation) await messageAggregator.submit(reservation, { accepted: false });
        return '';
      }

      let downstream;
      try {
        downstream = await next();
      } catch (error) {
        if (reservation) await messageAggregator.submit(reservation, { accepted: false });
        throw error;
      }
      if (downstream !== undefined && downstream !== null && downstream !== '') {
        if (reservation) await messageAggregator.submit(reservation, { accepted: false });
        return downstream;
      }

      if (!event.userId || !event.chatId || !isYunoSessionEligible(event)) {
        if (reservation) await messageAggregator.submit(reservation, { accepted: false });
        return '';
      }
      if (event.selfId && event.userId === event.selfId) {
        if (reservation) await messageAggregator.submit(reservation, { accepted: false });
        return '';
      }
      if (mode === 'shadow') {
        runtimeLogger.info('koishi', 'shadow_event', {
          chatType: event.chatType,
          chatId: event.chatId,
          userId: event.userId,
          messageId: event.messageId,
          attachments: event.attachments.length,
          mentionsBot: event.mentionsBot,
          sessionType: event.source?.sessionType,
        });
        if (reservation) await messageAggregator.submit(reservation, { accepted: false });
        return '';
      }
      if (!runtime || !acceptingMessages || !isRuntimeAccepting()) {
        runtimeLogger.warn('koishi', 'Yuno runtime is not ready; message ignored', {
          chatId: event.chatId,
          messageId: event.messageId,
        });
        if (reservation) await messageAggregator.submit(reservation, { accepted: false });
        return '';
      }

      const processConversation = (conversationEvent) => runConversation(conversationEvent, {
        responseMode: 'send',
        runtimeConfig,
        deps: {
          deliveryAdapter,
          protocolAdapter,
          sendReply: deliveryAdapter.sendReply.bind(deliveryAdapter),
          sendStructuredReply: deliveryAdapter.sendStructuredReply.bind(deliveryAdapter),
          sendVoice: deliveryAdapter.sendVoice.bind(deliveryAdapter),
        },
      });

      try {
        if (reservation) {
          await messageAggregator.submit(reservation, {
            accepted: true,
            process: processConversation,
          });
        } else {
          await processConversation(event);
        }
      } catch (error) {
        runtimeLogger.error('koishi', 'Yuno message processing failed', {
          message: error.message,
          chatId: event.chatId,
          userId: event.userId,
          messageId: event.messageId,
        });
      }
      return '';
    });

    ctx.on('dispose', async () => {
      acceptingMessages = false;
      await messageAggregator.close({ flush: true });
      if (runtime) {
        await shutdownRuntime();
        runtime = null;
      }
    });
  };
}

export { formatStatus, isAdmin, isKoishiAdminCommand, isYunoSessionEligible };
