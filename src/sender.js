import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';

const headers = config.napcatToken ? { Authorization: config.napcatToken } : {};

async function postNapcat(payload, label) {
  return withRetry(
    () => axios.post(`${config.napcatApi}/send_group_msg`, payload, {
      headers,
      timeout: config.requestTimeoutMs,
    }),
    {
      retries: config.retryAttempts,
      delayMs: config.retryDelayMs,
      category: 'sender',
      label,
      logger,
    }
  );
}

export async function sendText(groupId, text) {
  await postNapcat({
    group_id: Number(groupId),
    message: [{ type: 'text', data: { text } }],
  }, 'send text');
}

export async function sendVoice(groupId, mp3Buffer) {
  if (!mp3Buffer) {
    logger.info('sender', 'Voice skipped because no audio buffer was produced');
    return;
  }

  try {
    const { encode } = await import('silk-sdk');
    const silkBuffer = await encode(mp3Buffer, { targetBitrate: 24000 });
    await postNapcat({
      group_id: Number(groupId),
      message: [{
        type: 'record',
        data: { file: `base64://${silkBuffer.toString('base64')}` },
      }],
    }, 'send voice');
  } catch (error) {
    logger.warn('sender', 'Voice send skipped', { message: error.message });
  }
}
