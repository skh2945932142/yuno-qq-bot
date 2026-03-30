import express from 'express';
import { config, validateRuntimeConfig } from './config.js';
import { connectDB, isDbReady } from './db.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';
import { validateOnebotMessageEvent } from './adapters/onebot-event.js';
import { processPersistJob, processReplyJob, shouldRespondToEvent } from './message-workflow.js';
import { createQueueManager } from './queue-manager.js';
import { metrics, recordWorkflowMetric } from './metrics.js';
import { getTelemetryStatus, initializeTelemetry } from './telemetry.js';
import { setRuntimeServices, getRuntimeServices } from './runtime-services.js';
import { recordInboundGroupObservation } from './group-ops.js';
import { evaluateGroupAutomation } from './group-automation.js';
import { runYunoConversation } from './yuno-core.js';
import { isNonTargetPokeEvent } from './message-analysis.js';

function buildReplyJobId(event) {
  return `reply:${event.platform}:${event.chatId}:${event.messageId || `${event.userId}:${event.timestamp}`}`;
}

async function deliverAutomationToolResult(event, toolResult) {
  return runYunoConversation({
    platform: event.platform,
    scene: event.chatType,
    userId: event.userId,
    groupId: event.chatType === 'group' ? event.chatId : '',
    chatId: event.chatId,
    username: event.userName,
    rawMessage: event.rawText || event.text || '',
    metadata: {
      messageId: event.messageId,
      timestamp: event.timestamp,
      mentionsBot: event.mentionsBot,
      source: event.source,
      sender: event.sender,
      attachments: event.attachments,
      replyTo: event.replyTo,
    },
  }, {
    toolResult,
    responseMode: 'send',
  });
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.post('/onebot', async (req, res) => {
    res.send();

    const validation = validateOnebotMessageEvent(req.body);
    if (!validation.ok) {
      logger.info('webhook', 'Ignored unsupported webhook payload', {
        errors: validation.errors,
      });
      return;
    }

    const event = validation.value;
    recordWorkflowMetric('yuno_incoming_messages_total', 1, {
      chat_type: event.chatType,
    });

    try {
      if (event.chatType === 'group' && isNonTargetPokeEvent(event)) {
        recordWorkflowMetric('yuno_poke_ignored_total', 1, {
          chat_type: event.chatType,
          reason: 'non-target-poke',
        });
        recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
          chat_type: event.chatType,
          reason: 'non-target-poke',
        });
        logger.info('webhook', 'Ignored non-target poke event', {
          chatId: event.chatId,
          userId: event.userId,
          messageId: event.messageId,
          decisionReason: 'non-target-poke',
        });
        return;
      }

      if (event.chatType === 'group') {
        try {
          await recordInboundGroupObservation(event);
        } catch (error) {
          logger.warn('group-ops', 'Failed to record inbound group observation', {
            message: error.message,
            chatId: event.chatId,
            userId: event.userId,
            messageId: event.messageId,
          });
        }

        let automationDecision = null;
        try {
          automationDecision = await evaluateGroupAutomation(event);
          for (const toolResult of automationDecision.toolResults || []) {
            await deliverAutomationToolResult(event, toolResult);
            recordWorkflowMetric('yuno_automation_messages_total', 1, {
              chat_type: event.chatType,
              tool: toolResult.tool,
            });
          }
        } catch (error) {
          logger.warn('automation', 'Failed to evaluate group automation', {
            message: error.message,
            chatId: event.chatId,
            userId: event.userId,
            messageId: event.messageId,
          });
        }

        if (automationDecision?.suppressNormalReply) {
          recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
            chat_type: event.chatType,
            reason: 'automation-suppressed',
          });
          return;
        }

        if (event.source?.noticeType === 'group_increase') {
          return;
        }
      }

      const decision = await shouldRespondToEvent(event);
      if (!decision.analysis.shouldRespond) {
        recordWorkflowMetric('yuno_suppressed_messages_total', 1, {
          chat_type: event.chatType,
          reason: decision.analysis.reason,
        });
        return;
      }

      const runtimeServices = getRuntimeServices();
      await runtimeServices.queueManager.enqueueReply({
        event,
        analysis: decision.analysis,
      }, {
        jobId: buildReplyJobId(event),
      });
    } catch (error) {
      logger.error('webhook', 'Failed to process incoming message', {
        message: error.message,
        chatId: event.chatId,
        userId: event.userId,
        messageId: event.messageId,
      });
    }
  });

  app.get('/health', (_req, res) => {
    res.send('Yuno online');
  });

  app.get('/ready', (_req, res) => {
    const runtimeServices = getRuntimeServices();
    const ready = isDbReady() && Boolean(runtimeServices.queueManager?.getStatus().ready);
    res.status(ready ? 200 : 503).json({
      ready,
      db: isDbReady(),
      queue: runtimeServices.queueManager?.getStatus() || null,
      telemetry: getTelemetryStatus(),
    });
  });

  app.get(config.metricsPath, (_req, res) => {
    if (!config.enableMetrics) {
      res.status(404).send('metrics disabled');
      return;
    }

    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.snapshot());
  });

  return app;
}

export async function startApplication() {
  validateRuntimeConfig();
  await connectDB();
  await initializeTelemetry(config);

  const queueManager = await createQueueManager(config, {
    replyJob: async (payload, job) => processReplyJob(payload, {
      queueJobId: job.id,
    }),
    persistJob: async (payload, job) => processPersistJob(payload, {
      queueJobId: job.id,
    }),
  });

  setRuntimeServices({ queueManager });
  startScheduler();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info('webhook', 'Yuno QQ Bot started', {
      port: config.port,
      queueMode: queueManager.getStatus().mode,
      metricsPath: config.metricsPath,
    });
  });
}
