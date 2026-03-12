import express from 'express';
import { config, validateRuntimeConfig } from './config.js';
import { connectDB } from './db.js';
import { handleMessage, shouldRespond } from './emotion.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';

const app = express();
app.use(express.json());

app.post('/onebot', async (req, res) => {
  res.send('OK');

  const event = req.body;
  if (event.post_type !== 'message' || event.message_type !== 'group') {
    return;
  }

  try {
    const decision = await shouldRespond(event);
    if (!decision.analysis.shouldRespond) {
      return;
    }

    await handleMessage(event, decision);
  } catch (error) {
    logger.error('webhook', 'Failed to process incoming message', { message: error.message });
  }
});

app.get('/health', (_, res) => {
  res.send('由乃在线');
});

async function main() {
  validateRuntimeConfig();
  await connectDB();
  startScheduler();

  app.listen(config.port, () => {
    logger.info('webhook', 'Yuno QQ Bot started', { port: config.port });
  });
}

main().catch((error) => {
  logger.error('bootstrap', 'Application failed to start', { message: error.message });
  process.exit(1);
});
