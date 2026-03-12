import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import {
  encodeTencentSilk,
  resolveFfmpegPath,
  transcodeMp3ToSpeechPcm,
} from './services/audio.js';

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

export async function sendVoiceWithDeps(groupId, mp3Buffer, deps = {}) {
  const postNapcatFn = deps.postNapcat || postNapcat;
  const resolveFfmpegPathFn = deps.resolveFfmpegPath || resolveFfmpegPath;
  const transcodeFn = deps.transcodeMp3ToSpeechPcm || transcodeMp3ToSpeechPcm;
  const encodeFn = deps.encodeTencentSilk || encodeTencentSilk;
  const loggerImpl = deps.logger || logger;

  if (!mp3Buffer || mp3Buffer.length === 0) {
    loggerImpl.info('sender', 'voice_skipped', { reason: 'empty_tts_buffer' });
    return false;
  }

  loggerImpl.info('sender', 'tts_received', { bytes: mp3Buffer.length });

  const ffmpegPath = await resolveFfmpegPathFn();
  if (!ffmpegPath) {
    loggerImpl.warn('sender', 'voice_skipped', { reason: 'ffmpeg_unavailable' });
    return false;
  }

  try {
    const pcmBuffer = await transcodeFn(mp3Buffer, { ffmpegPath });
    loggerImpl.info('sender', 'ffmpeg_transcoded', {
      ffmpegAvailable: true,
      bytes: pcmBuffer.length,
    });

    const silkBuffer = await encodeFn(pcmBuffer);
    loggerImpl.info('sender', 'silk_encoded', { bytes: silkBuffer.length });

    await postNapcatFn({
      group_id: Number(groupId),
      message: [{
        type: 'record',
        data: { file: `base64://${silkBuffer.toString('base64')}` },
      }],
    }, 'send voice');

    loggerImpl.info('sender', 'napcat_voice_sent', {
      groupId: Number(groupId),
      bytes: silkBuffer.length,
    });
    return true;
  } catch (error) {
    loggerImpl.warn('sender', 'voice_skipped', {
      reason: 'voice_pipeline_failed',
      message: error.message,
      status: error.response?.status,
      code: error.code,
    });
    return false;
  }
}

export async function sendVoice(groupId, mp3Buffer) {
  return sendVoiceWithDeps(groupId, mp3Buffer);
}
