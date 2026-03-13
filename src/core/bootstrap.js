import { config, validateRuntimeConfig } from '../config.js';
import { connectDB } from '../db.js';
import { logger } from '../logger.js';
import { startScheduler } from '../scheduler.js';
import { createApp } from '../api/app.js';

export async function startApplication() {
  validateRuntimeConfig();
  await connectDB();
  startScheduler();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info('webhook', 'Yuno QQ Bot started', { port: config.port });
  });
}
