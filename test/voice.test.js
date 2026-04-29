import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeTencentSilk,
  resetFfmpegPathCache,
  resolveFfmpegPath,
  transcodeMp3ToSpeechPcm,
} from '../src/services/audio.js';
import { sendVoiceWithDeps } from '../src/sender.js';

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

test('sendVoiceWithDeps skips voice when ffmpeg is unavailable', async () => {
  const logs = [];
  const sentPayloads = [];

  const success = await sendVoiceWithDeps('12345', Buffer.from('wav-data'), {
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
    resolveFfmpegPath: async () => null,
    postNapcat: async (payload) => {
      sentPayloads.push(payload);
    },
  });

  assert.equal(success, false);
  assert.equal(sentPayloads.length, 0);
  assert.equal(logs.some((entry) => entry[2] === 'voice_skipped'), true);
});

test('sendVoiceWithDeps posts qq-compatible record after transcoding', async () => {
  const sentPayloads = [];

  const success = await sendVoiceWithDeps('12345', Buffer.from('wav-data'), {
    logger: {
      info: () => {},
      warn: () => {},
    },
    resolveFfmpegPath: async () => 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    transcodeMp3ToSpeechPcm: async () => Buffer.from('wav-data'),
    encodeTencentSilk: async () => Buffer.from('silk-data'),
    postNapcat: async (payload) => {
      sentPayloads.push(payload);
    },
  });

  assert.equal(success, true);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].message[0].type, 'record');
  assert.match(sentPayloads[0].message[0].data.file, /^base64:\/\//);
});
