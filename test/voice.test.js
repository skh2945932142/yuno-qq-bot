import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpeechAudioFilter,
  encodeTencentSilk,
  resetFfmpegPathCache,
  resolveFfmpegPath,
  transcodeMp3ToSpeechPcm,
} from '../src/services/audio.js';
import { createKoishiDeliveryAdapter } from '../src/koishi-adapters.js';

function createDeliveryAdapter(options = {}) {
  const sent = [];
  const adapter = createKoishiDeliveryAdapter({
    bots: [{
      platform: 'onebot',
      selfId: '10000',
      async sendMessage(channelId, content) {
        sent.push({ channelId, content });
      },
    }],
  }, {
    selfId: '10000',
    logger: options.logger || { warn: () => {} },
    resolveFfmpegPath: options.resolveFfmpegPath,
    transcodeAudioToSpeechPcm: options.transcodeAudioToSpeechPcm,
    encodeTencentSilk: options.encodeTencentSilk,
  });
  return { adapter, sent };
}

test('resolveFfmpegPath prefers explicit path when it exists', async () => {
  resetFfmpegPathCache();

  const result = await resolveFfmpegPath({
    explicitPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    fileExists: async (targetPath) => targetPath === 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    locateBinary: async () => null,
    skipCache: true,
  });

  assert.equal(result, 'C:\\ffmpeg\\bin\\ffmpeg.exe');
});

test('resolveFfmpegPath falls back to binary lookup', async () => {
  resetFfmpegPathCache();

  const result = await resolveFfmpegPath({
    explicitPath: '',
    fileExists: async () => false,
    locateBinary: async () => 'D:\\tools\\ffmpeg.exe',
    skipCache: true,
  });

  assert.equal(result, 'D:\\tools\\ffmpeg.exe');
});

test('transcodeMp3ToSpeechPcm throws when ffmpeg is unavailable', async () => {
  await assert.rejects(
    () => transcodeMp3ToSpeechPcm(Buffer.from('mp3'), {
      explicitPath: '',
      fileExists: async () => false,
      locateBinary: async () => null,
      skipCache: true,
    }),
    /ffmpeg is not available/
  );
});

test('buildSpeechAudioFilter applies bounded pitch-preserving playback speed', () => {
  assert.equal(buildSpeechAudioFilter({ playbackSpeed: 1.15 }), 'atempo=1.15');
  assert.equal(buildSpeechAudioFilter({ playbackSpeed: 1 }), '');
  assert.equal(buildSpeechAudioFilter({ playbackSpeed: 3 }), 'atempo=2');
  assert.equal(buildSpeechAudioFilter({ playbackSpeed: 0.2 }), 'atempo=0.5');
});

test('encodeTencentSilk enables tencent-compatible options', async () => {
  let receivedOptions;

  const result = await encodeTencentSilk(Buffer.from('wav-data'), {
    encodeImpl: async (_buffer, options) => {
      receivedOptions = options;
      return Buffer.from('silk-data');
    },
    sampleRate: 24000,
    rate: 24500,
  });

  assert.equal(result.toString(), 'silk-data');
  assert.deepEqual(receivedOptions, {
    fsHz: 24000,
    packetLength: 20,
    rate: 24500,
    tencent: true,
    quiet: true,
  });
});

test('Koishi delivery skips voice when ffmpeg is unavailable', async () => {
  const logs = [];
  const { adapter, sent } = createDeliveryAdapter({
    logger: { warn: (...args) => logs.push(args) },
    resolveFfmpegPath: async () => null,
  });

  const success = await adapter.sendVoice({ platform: 'qq', chatType: 'private', chatId: '12345' }, Buffer.from('wav-data'));

  assert.equal(success, false);
  assert.equal(sent.length, 0);
  assert.equal(logs.length, 1);
});

test('Koishi delivery skips empty audio without sending', async () => {
  const { adapter, sent } = createDeliveryAdapter({
    resolveFfmpegPath: async () => 'C:\\ffmpeg\\bin\\ffmpeg.exe',
  });

  const success = await adapter.sendVoice({ platform: 'qq', chatType: 'private', chatId: '12345' }, Buffer.alloc(0));

  assert.equal(success, false);
  assert.equal(sent.length, 0);
});

test('Koishi delivery returns false when Silk encoding fails', async () => {
  const { adapter, sent } = createDeliveryAdapter({
    resolveFfmpegPath: async () => 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    transcodeAudioToSpeechPcm: async () => Buffer.from('wav-data'),
    encodeTencentSilk: async () => {
      throw new Error('encode failed');
    },
  });

  const success = await adapter.sendVoice({ platform: 'qq', chatType: 'private', chatId: '12345' }, Buffer.from('wav-data'));

  assert.equal(success, false);
  assert.equal(sent.length, 0);
});

test('Koishi delivery emits a QQ-compatible Silk record element', async () => {
  const { adapter, sent } = createDeliveryAdapter({
    resolveFfmpegPath: async () => 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    transcodeAudioToSpeechPcm: async () => Buffer.from('wav-data'),
    encodeTencentSilk: async () => Buffer.from('silk-data'),
  });

  const success = await adapter.sendVoice({ platform: 'qq', chatType: 'private', chatId: '12345' }, Buffer.from('wav-data'));

  assert.equal(success, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, 'private:12345');
  assert.match(sent[0].content, /audio/);
  assert.match(sent[0].content, /data:audio\/silk;base64,c2lsay1kYXRh/);
});
