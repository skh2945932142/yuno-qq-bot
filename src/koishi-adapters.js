import { createRequire } from 'node:module';
import { config } from './config.js';
import { logger } from './logger.js';
import {
  encodeTencentSilk,
  resolveFfmpegPath,
  transcodeAudioToSpeechPcm,
} from './services/audio.js';

const require = createRequire(import.meta.url);
const { h } = require('koishi');
const { Status } = require('@satorijs/protocol');
const PRIVATE_CHANNEL_PREFIX = 'private:';

function isBotOnline(status) {
  return status === undefined
    || status === null
    || status === ''
    || status === Status.ONLINE
    || String(status).trim().toLowerCase() === 'online';
}

function resolveBot(context, options = {}) {
  const bots = Array.isArray(context?.bots) ? context.bots : [];
  const expectedSelfId = String(options.selfId || config.selfQq || '').trim();
  const platform = String(options.platform || 'onebot').trim();
  const candidates = bots.filter((bot) => String(bot.platform || '') === platform);
  const selected = expectedSelfId
    ? candidates.find((bot) => String(bot.selfId) === expectedSelfId)
    : candidates[0];

  if (!selected) {
    const error = new Error(expectedSelfId ? 'KOISHI_CONFIGURED_BOT_UNAVAILABLE' : 'KOISHI_BOT_UNAVAILABLE');
    error.code = expectedSelfId ? 'KOISHI_CONFIGURED_BOT_UNAVAILABLE' : 'KOISHI_BOT_UNAVAILABLE';
    throw error;
  }
  if (!isBotOnline(selected.status)) {
    const error = new Error('KOISHI_BOT_OFFLINE');
    error.code = 'KOISHI_BOT_OFFLINE';
    throw error;
  }
  return selected;
}

function resolveImageSource(image) {
  if (!image) return '';
  if (typeof image === 'string') return image;
  if (image.file) return image.file;
  if (image.path) return image.path;
  if (image.url) return image.url;
  if (image.base64) return `data:${image.mimeType || 'image/png'};base64,${image.base64}`;
  return '';
}

function renderOutputs(outputs = []) {
  return outputs.flatMap((output) => {
    if (!output) return [];
    if (output.type === 'text' && String(output.text || '').trim()) {
      return [h.text(String(output.text))];
    }
    if (output.type === 'image') {
      const source = resolveImageSource(output.image);
      return source ? [h.image(source)] : [];
    }
    return [];
  }).map(String).join('');
}

async function buildVoiceElement(audioBuffer, deps = {}) {
  const resolveFfmpeg = deps.resolveFfmpegPath || resolveFfmpegPath;
  const transcode = deps.transcodeAudioToSpeechPcm || transcodeAudioToSpeechPcm;
  const encode = deps.encodeTencentSilk || encodeTencentSilk;
  const ffmpegPath = await resolveFfmpeg();
  if (!ffmpegPath) return null;
  const pcm = await transcode(audioBuffer, { ffmpegPath });
  const silk = await encode(pcm);
  return h.audio(`data:audio/silk;base64,${silk.toString('base64')}`);
}

function toChannelId(target = {}) {
  const chatId = String(target.chatId || '').trim();
  return target.chatType === 'private' ? `${PRIVATE_CHANNEL_PREFIX}${chatId}` : chatId;
}

function toDeliveryError(error, target) {
  const wrapped = new Error(`YUNO_DELIVERY_FAILED: ${error.message || 'unknown OneBot delivery error'}`);
  wrapped.code = 'YUNO_DELIVERY_FAILED';
  wrapped.cause = error;
  wrapped.target = target;
  return wrapped;
}

export function createKoishiDeliveryAdapter(context, options = {}) {
  const loggerImpl = options.logger || logger;
  const resolve = (target) => resolveBot(context, {
    ...options,
    platform: target?.platform === 'qq' ? 'onebot' : options.platform,
  });

  async function sendMessage(target, content) {
    if (!content) return false;
    try {
      const bot = resolve(target);
      await bot.sendMessage(toChannelId(target), content);
      return true;
    } catch (error) {
      throw toDeliveryError(error, target);
    }
  }

  return {
    async sendReply(target, text) {
      return sendMessage(target, String(text || ''));
    },
    async sendStructuredReply(target, outputs = []) {
      return sendMessage(target, renderOutputs(outputs));
    },
    async sendVoice(target, audioBuffer) {
      if (!audioBuffer || audioBuffer.length === 0) return false;
      let element;
      try {
        element = await buildVoiceElement(audioBuffer, options);
      } catch (error) {
        loggerImpl.warn('delivery', 'Voice encoding failed', { message: error.message });
        return false;
      }
      if (!element) {
        loggerImpl.warn('delivery', 'Voice skipped because ffmpeg is unavailable');
        return false;
      }
      return sendMessage(target, String(element));
    },
  };
}

export function createKoishiProtocolAdapter(context, options = {}) {
  return {
    async callAction(action, payload = {}) {
      const bot = resolveBot(context, options);
      const request = bot.internal?._request;
      if (typeof request !== 'function') {
        const error = new Error('KOISHI_ONEBOT_INTERNAL_UNAVAILABLE');
        error.code = 'KOISHI_ONEBOT_INTERNAL_UNAVAILABLE';
        throw error;
      }
      try {
        const response = await request.call(bot.internal, action, payload);
        if (response?.retcode !== undefined && response.retcode !== 0) {
          const error = new Error(`OneBot action failed: ${action}`);
          error.code = response.retcode;
          error.response = response;
          throw error;
        }
        return response?.data ?? response;
      } catch (error) {
        if (error.code === 'KOISHI_BOT_OFFLINE' || error.code === 'KOISHI_CONFIGURED_BOT_UNAVAILABLE') {
          throw error;
        }
        const wrapped = new Error(`YUNO_PROTOCOL_ACTION_FAILED: ${action}`);
        wrapped.code = 'YUNO_PROTOCOL_ACTION_FAILED';
        wrapped.cause = error;
        throw wrapped;
      }
    },
  };
}

export {
  PRIVATE_CHANNEL_PREFIX,
  buildVoiceElement,
  isBotOnline,
  renderOutputs,
  resolveBot,
  resolveImageSource,
  toChannelId,
};
