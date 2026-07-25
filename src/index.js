import { logger } from './logger.js';
import { startKoishiApplication, stopKoishiApplication } from './koishi-app.js';

let application = null;
let stopping = false;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  try {
    await stopKoishiApplication(application);
    logger.info('bootstrap', 'Koishi application stopped', { signal });
    process.exit(0);
  } catch (error) {
    logger.error('bootstrap', 'Koishi application shutdown failed', { signal, message: error.message });
    process.exit(1);
  }
}

startKoishiApplication()
  .then((ctx) => {
    application = ctx;
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch((error) => {
    logger.error('bootstrap', 'Koishi application failed to start', { message: error.message });
    process.exit(1);
  });