import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTtsRequest, extractTtsAudioBuffer } from '../src/minimax.js';

test('buildTtsRequest creates chat-completions payload for mimo provider', () => {
  const request = buildTtsRequest('hello', {}, {
    enableVoice: true,
    ttsProvider: 'mimo',
    ttsBaseUrl: 'https://api.example.com/v1/chat/completions',
    ttsApiKey: 'secret',
    ttsModel: 'mimo-v2.5-tts',
    ttsVoice: 'mimo_default',
    yunoVoiceUri: '',
    requestTimeoutMs: 12000,
  });

  assert.equal(request.ok, true);
  assert.equal(request.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(request.payload.model, 'mimo-v2.5-tts');
  assert.equal(request.payload.messages[0].role, 'user');
  assert.match(request.payload.messages[0].content, /自然|清晰|朗读/);
  assert.deepEqual(request.payload.messages[1], {
    role: 'assistant',
    content: 'hello',
  });
  assert.deepEqual(request.payload.audio, {
    format: 'wav',
    voice: 'mimo_default',
  });
  assert.equal(request.requestOptions.headers['api-key'], 'secret');
  assert.equal(request.requestOptions.headers.Authorization, 'Bearer secret');
});

test('buildTtsRequest reports missing voice configuration', () => {
  const request = buildTtsRequest('hello', {}, {
    enableVoice: true,
    ttsProvider: 'mimo',
    ttsBaseUrl: 'https://api.example.com/v1/chat/completions',
    ttsApiKey: 'secret',
    ttsModel: 'mimo-v2.5-tts',
    ttsVoice: '',
    yunoVoiceUri: '',
    requestTimeoutMs: 12000,
  });

  assert.equal(request.ok, false);
  assert.equal(request.reason, 'missing_voice_uri');
});

test('extractTtsAudioBuffer decodes mimo base64 audio payload', () => {
  const audio = extractTtsAudioBuffer({
    data: {
      choices: [{
        message: {
          audio: {
            data: Buffer.from('wav-audio').toString('base64'),
          },
        },
      }],
    },
  }, 'mimo');

  assert.equal(audio?.toString(), 'wav-audio');
});
