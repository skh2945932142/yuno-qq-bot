import { logger } from './logger.js';
import { startApplication } from './bootstrap-phase1.js';

startApplication().catch((error) => {
  logger.error('bootstrap', 'Application failed to start', { message: error.message });
  process.exit(1);
});
