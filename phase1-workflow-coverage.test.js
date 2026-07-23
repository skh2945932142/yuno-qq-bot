import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMemeImageOutput,
  enforceEmojiBudget,
  normalizeReplyFormatting,
  normalizeVoiceTtsText,
  resolveVoiceReplyDecision,
  shapeChatReplyText,
  stripHiddenReasoning,
} from './src/message-workflow.js';

function voiceDecision(overrides = {}) {
  return resolveVoiceReplyDecision({
    event: {
      chatType: 'private',
      chatId: 'voice-user',
      rawText: 'reply normally',
      text: 'reply normally',
      attachments: [],
    },
    route: { category: 'private_chat' },
    replyDecision: { sendVoice: false },
    replyText: 'I am here.',
    voiceText: 'I am here.',
    emotionResult: { emotion: 'CALM', intensity: 0.2 },
    nowMs: 10_000,
    runtimeConfig: {
      enableVoice: true,
      voiceName: 'test-voice',
      mode: 'auto',
      maxChars: 90,
      cooldownMs: 0,
      onUserRecord: true,
    },
    ...overrides,
  });
}

test('workflow text helpers cover empty, emoji, structured, and reasoning boundaries', () => {
  assert.equal(enforceEmojiBudget(undefined, undefined), '');
  assert.equal(enforceEmojiBudget('ok✨no😀✨', { emojiBudget: 1, emojiStyle: 'soft' }), 'ok✨no');
  assert.equal(enforceEmojiBudget('a😀b', { emojiBudget: 2, emojiStyle: 'all' }), 'a😀b');

  assert.equal(normalizeReplyFormatting(null), '');
  assert.equal(normalizeReplyFormatting('\n only \n'), 'only');
  assert.equal(normalizeReplyFormatting('first\nsecond'), 'first second');
  assert.equal(normalizeReplyFormatting('第一句\n第二句'), '第一句第二句');
  assert.equal(normalizeReplyFormatting('title\n- item'), 'title\n- item');

  assert.equal(stripHiddenReasoning('分析：skip\n- still skip\nanswer\n\nnext'), 'answer\n\nnext');
  assert.equal(stripHiddenReasoning('<think>secret</think>\nvisible'), 'visible');
  assert.equal(shapeChatReplyText('same. same. fine...', { emojiBudget: 0 }), 'same. same. fine……');
});

test('normalizeVoiceTtsText handles default limits, sentence cuts, and hard truncation', () => {
  assert.equal(normalizeVoiceTtsText(undefined), '');
  assert.equal(
    normalizeVoiceTtsText('Short sentence. Another sentence.', { maxChars: Number.NaN }),
    'Short sentence. Another sentence.'
  );
  assert.equal(
    normalizeVoiceTtsText('第一句很短。第二句会继续延伸。', { maxChars: 8 }),
    '第一句很短。'
  );
  assert.equal(normalizeVoiceTtsText('abcdefghij, trailing', { maxChars: 10 }), 'abcdefghij');
});

test('resolveVoiceReplyDecision reports configuration and scene suppression reasons', () => {
  assert.equal(voiceDecision({ runtimeConfig: { enableVoice: false } }).reason, 'voice-disabled');
  assert.equal(voiceDecision({ runtimeConfig: { enableVoice: true, voiceName: '' } }).reason, 'missing-voice');
  assert.equal(voiceDecision({ runtimeConfig: { enableVoice: true, voiceName: 'v', mode: 'off' } }).reason, 'mode-off');
  assert.equal(voiceDecision({
    event: { chatType: 'notice', chatId: '', attachments: [] },
  }).reason, 'scene-not-allowed');
  assert.equal(voiceDecision({ replyText: '', voiceText: '' }).reason, 'empty-voice-text');
  assert.equal(voiceDecision({
    route: { category: 'knowledge_qa' },
    replyDecision: { sendVoice: true },
  }).reason, 'route-not-voice-friendly');
  assert.equal(voiceDecision().reason, 'policy-not-suggested');
});

test('resolveVoiceReplyDecision covers every positive policy reason and aliases', () => {
  assert.equal(voiceDecision({
    runtimeConfig: { enableVoice: true, voiceName: 'v', mode: 'force', voiceReplyMaxChars: 30 },
  }).reason, 'mode-force');

  assert.equal(voiceDecision({
    event: {
      chatType: 'group',
      chatId: 'voice-group',
      rawText: 'use voice please',
      attachments: [],
      mentionsBot: false,
    },
  }).reason, 'explicit-request');

  assert.equal(voiceDecision({
    event: {
      chatType: 'private',
      chatId: 'record-user',
      rawText: '',
      attachments: [{ type: 'RECORD' }],
    },
  }).reason, 'user-sent-voice');

  assert.equal(voiceDecision({
    emotionResult: { emotion: 'PROTECTIVE', intensity: 0.9 },
  }).reason, 'emotion-suggested');

  assert.equal(voiceDecision({
    replyDecision: { sendVoice: true },
    lastVoiceSentAtByChat: new Map([['private:voice-user', 9_500]]),
    runtimeConfig: {
      enableVoice: true,
      voiceName: 'v',
      mode: 'model',
      maxChars: 90,
      cooldownMs: 1_000,
    },
  }).reason, 'voice-cooldown');
});

test('buildMemeImageOutput normalizes URLs, base64, local files, and missing assets', async () => {
  assert.deepEqual(await buildMemeImageOutput({ imageUrl: 'https://example.test/meme.png' }), {
    type: 'image',
    image: { file: 'https://example.test/meme.png' },
  });
  assert.deepEqual(await buildMemeImageOutput({ storagePath: 'meme.png' }, { preferBase64: true }, {
    readFile: async () => Buffer.from('abc'),
  }), {
    type: 'image',
    image: { base64: 'YWJj' },
  });
  assert.deepEqual(await buildMemeImageOutput({ storagePath: 'meme.png' }), {
    type: 'image',
    image: { file: 'meme.png' },
  });
  assert.deepEqual(await buildMemeImageOutput({}), {
    type: 'image',
    image: { file: '' },
  });
});
