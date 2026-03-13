import express from 'express';
import { handleOnebotWebhook } from './onebot-handler.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.post('/onebot', handleOnebotWebhook);
  app.get('/health', (_req, res) => {
    res.send('Yuno online');
  });

  return app;
}
