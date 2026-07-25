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

function isKoishiAdminCommand(session = {}) {
  return /^\s*\/koishi(?:\s|$)/i.test(String(session.content || ''));
}

function isAdmin(session = {}, runtimeConfig = config) {
  return Boolean(runtimeConfig.adminQq)
    && String(session.userId || '') === String(runtimeConfig.adminQq);
}

function isYunoSessionEligible(event = {}) {
  if (event.source?.postType === 'message') return true;
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

  return (ctx) => {
    const deliveryAdapter = options.deliveryAdapter || createKoishiDeliveryAdapter(ctx, {
      selfId: runtimeConfig.selfQq,
      logger: options.logger || logger,
    });
    const protocolAdapter = options.protocolAdapter || createKoishiProtocolAdapter(ctx, {
      selfId: runtimeConfig.selfQq,
    });
    let runtime = null;
    let acceptingMessages = false;

    ctx.on('ready', async () => {
      if (mode === 'shadow') {
        logger.info('koishi', 'Yuno plugin started in shadow mode');
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
      if (isKoishiAdminCommand(session)) {
        if (!isAdmin(session, runtimeConfig)) {
          await session.send('没有这个管理权限。');
          return '';
        }
        const command = String(session.content || '').trim().split(/\s+/)[1] || 'status';
        if (command === 'status' || command === 'health') {
          await session.send(formatStatus(getYunoRuntimeStatus()));
        } else {
          await session.send('可用命令：/koishi status');
        }
        return '';
      }

      const downstream = await next();
      if (downstream !== undefined && downstream !== null && downstream !== '') {
        return downstream;
      }

      const event = adaptKoishiSession(session);
      if (!event.userId || !event.chatId || !isYunoSessionEligible(event)) return '';
      if (event.selfId && event.userId === event.selfId) return '';
      if (mode === 'shadow') {
        logger.info('koishi', 'shadow_event', {
          chatType: event.chatType,
          chatId: event.chatId,
          userId: event.userId,
          messageId: event.messageId,
          attachments: event.attachments.length,
          mentionsBot: event.mentionsBot,
          sessionType: event.source?.sessionType,
        });
        return '';
      }
      if (!runtime || !acceptingMessages || !isRuntimeAccepting()) {
        logger.warn('koishi', 'Yuno runtime is not ready; message ignored', {
          chatId: event.chatId,
          messageId: event.messageId,
        });
        return '';
      }

      try {
        await runConversation(event, {
          responseMode: 'send',
          deps: {
            deliveryAdapter,
            protocolAdapter,
            sendReply: deliveryAdapter.sendReply.bind(deliveryAdapter),
            sendStructuredReply: deliveryAdapter.sendStructuredReply.bind(deliveryAdapter),
            sendVoice: deliveryAdapter.sendVoice.bind(deliveryAdapter),
          },
        });
      } catch (error) {
        logger.error('koishi', 'Yuno message processing failed', {
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
      if (runtime) {
        await shutdownRuntime();
        runtime = null;
      }
    });
  };
}

export { formatStatus, isAdmin, isKoishiAdminCommand, isYunoSessionEligible };
