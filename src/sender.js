import axios from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import { buildReplyTarget } from './chat/session.js';
import {
  encodeTencentSilk,
  resolveFfmpegPath,
  transcodeAudioToSpeechPcm,
  transcodeMp3ToSpeechPcm,
} from './services/audio.js';

const headers = config.napcatToken ? { Authorization: config.napcatToken } : {};

async function postNapcat(action, payload, label) {
  return withRetry(
    () => axios.post(`${config.napcatApi}/${action}`, payload, {
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

async function invokePostNapcat(postNapcatFn, action, payload, label) {
  if (postNapcatFn === postNapcat || postNapcatFn.length >= 2) {
    return postNapcatFn(action, payload, label);
  }

  return postNapcatFn(payload, label);
}

function buildNapcatTargetPayload(target, message) {
  const normalizedTarget = buildReplyTarget(target);
  const idKey = normalizedTarget.chatType === 'private' ? 'user_id' : 'group_id';

  return {
    action: normalizedTarget.chatType === 'private' ? 'send_private_msg' : 'send_group_msg',
    payload: {
      [idKey]: Number(normalizedTarget.chatId),
      message,
    },
    target: normalizedTarget,
  };
}

function normalizeImageMessage(image) {
  if (!image) {
    return null;
  }

  if (typeof image === 'string') {
    return { type: 'image', data: { file: image } };
  }

  if (image.file) {
    return { type: 'image', data: { file: image.file } };
  }

  if (image.url) {
    return { type: 'image', data: { file: image.url } };
  }

  if (image.base64) {
    return { type: 'image', data: { file: `base64://${image.base64}` } };
  }

  return null;
}

export async function sendReply(target, text) {
  const request = buildNapcatTargetPayload(target, [{ type: 'text', data: { text } }]);
  await invokePostNapcat(postNapcat, request.action, request.payload, `send ${request.target.chatType} text`);
}

export async function sendStructuredReply(target, outputs = []) {
  const message = [];

  for (const output of outputs) {
    if (!output) {
      continue;
    }

    if (output.type === 'text' && output.text) {
      message.push({ type: 'text', data: { text: output.text } });
      continue;
    }

    if (output.type === 'image') {
      const normalized = normalizeImageMessage(output.image);
      if (normalized) {
        message.push(normalized);
      }
    }
  }

  if (message.length === 0) {
    return false;
  }

  const request = buildNapcatTargetPayload(target, message);
  await invokePostNapcat(postNapcat, request.action, request.payload, `send ${request.target.chatType} structured`);
  return true;
}

export async function sendImage(target, image) {
  return sendStructuredReply(target, [{ type: 'image', image }]);
}

export async function sendText(groupId, text, chatType = 'group') {
  await sendReply({
    platform: 'qq',
    chatType,
    chatId: groupId,
  }, text);
}

export async function sendVoiceWithDeps(target, audioBuffer, deps = {}) {
  const postNapcatFn = deps.postNapcat || postNapcat;
  const resolveFfmpegPathFn = deps.resolveFfmpegPath || resolveFfmpegPath;
  const transcodeFn = deps.transcodeAudioToSpeechPcm || deps.transcodeMp3ToSpeechPcm || transcodeAudioToSpeechPcm || transcodeMp3ToSpeechPcm;
  const encodeFn = deps.encodeTencentSilk || encodeTencentSilk;
  const loggerImpl = deps.logger || logger;
  const request = buildNapcatTargetPayload(target, [{
    type: 'record',
    data: { file: '' },
  }]);

  if (!audioBuffer || audioBuffer.length === 0) {
    loggerImpl.info('sender', 'voice_skipped', { reason: 'empty_tts_buffer' });
    return false;
  }

  loggerImpl.info('sender', 'tts_received', { bytes: audioBuffer.length });

  const ffmpegPath = await resolveFfmpegPathFn();
  if (!ffmpegPath) {
    loggerImpl.warn('sender', 'voice_skipped', { reason: 'ffmpeg_unavailable' });
    return false;
  }

  try {
    const pcmBuffer = await transcodeFn(audioBuffer, { ffmpegPath });
    loggerImpl.info('sender', 'ffmpeg_transcoded', {
      ffmpegAvailable: true,
      bytes: pcmBuffer.length,
    });

    const silkBuffer = await encodeFn(pcmBuffer);
    loggerImpl.info('sender', 'silk_encoded', { bytes: silkBuffer.length });

    await invokePostNapcat(postNapcatFn, request.action, {
      ...request.payload,
      message: [{
        type: 'record',
        data: { file: `base64://${silkBuffer.toString('base64')}` },
      }],
    }, `send ${request.target.chatType} voice`);

    loggerImpl.info('sender', 'napcat_voice_sent', {
      chatId: Number(request.target.chatId),
      chatType: request.target.chatType,
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

export async function sendVoice(target, audioBuffer) {
  return sendVoiceWithDeps(target, audioBuffer);
}
