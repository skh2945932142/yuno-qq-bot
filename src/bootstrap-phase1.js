import express from 'express';
import { config, validateRuntimeConfig } from './config.js';
import { connectDB } from './db.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';
import { validateOnebotMessageEvent } from './adapters/onebot-event.js';
import { processIncomingMessage, shouldRespondToEvent } from './message-workflow.js';

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
    try {
      const decision = await shouldRespondToEvent(event);
      if (!decision.analysis.shouldRespond) {
        return;
      }

      await processIncomingMessage(event, decision);
    } catch (error) {
      logger.error('webhook', 'Failed to process incoming message', {
        message: error.message,
      });
    }
  });

  app.get('/health', (_req, res) => {
    res.send('Yuno online');
  });

  return app;
}

export async function startApplication() {
  validateRuntimeConfig();
  await connectDB();
  startScheduler();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info('webhook', 'Yuno QQ Bot started', { port: config.port });
  });
}
