import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMemeAction } from './src/meme-agent.js';
import { generateQuoteMeme } from './src/meme-generator.js';
import { assessMemeSafety } from './src/meme-safety.js';

test('meme agent generates quote meme for explicit quote command', () => {
  const result = decideMemeAction({
    event: {
      rawText: '把这句做成图',
      attachments: [],
    },
    analysis: { shouldRespond: true },
    candidates: [],
    safety: { allowed: true, safetyFlags: [] },
    autoSend: false,
  });

  assert.equal(result.action, 'generate-quote');
});

test('quote meme generator returns embeddable svg image', () => {
  const image = generateQuoteMeme({
    username: 'Alice',
    text: 'This is a test quote for a fake screenshot.',
  });

  assert.equal(image.type, 'image');
  assert.match(image.file, /^data:image\/svg\+xml;base64,/);
});

test('meme safety blocks privacy-heavy content', () => {
  const safety = assessMemeSafety({
    text: 'my phone is 13800138000 and my address is secret',
  });

  assert.equal(safety.allowed, false);
  assert.match(safety.safetyFlags.join(','), /privacy/);
});
