import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceEmojiBudget } from '../src/message-workflow.js';

test('enforceEmojiBudget removes all emoji when budget is zero', () => {
  const result = enforceEmojiBudget('hello\u{1F60A}\u{1F49E}', {
    emojiBudget: 0,
    emojiStyle: 'none',
  });

  assert.equal(result, 'hello');
});

test('enforceEmojiBudget keeps only one allowed soft emoji in affectionate mode', () => {
  const result = enforceEmojiBudget('welcome\u{1F49E}\u2728', {
    emojiBudget: 1,
    emojiStyle: 'soft',
  });

  assert.equal(result, 'welcome\u{1F49E}');
});

test('enforceEmojiBudget collapses blank lines into a single newline', () => {
  const result = enforceEmojiBudget('line1\n\nline2\n\n\nline3', {
    emojiBudget: 0,
    emojiStyle: 'none',
  });

  assert.equal(result, 'line1\nline2\nline3');
});

test('normalizeReplyFormatting flattens poetic line breaks into normal sentence flow', async () => {
  const { normalizeReplyFormatting } = await import('../src/message-workflow.js');
  const result = normalizeReplyFormatting('嗯...？！又饿了？！\n你之前不是说在吃晚饭吗...\n怎么还在饿...\n快去吃东西...');

  assert.equal(result, '嗯...？！又饿了？！你之前不是说在吃晚饭吗...怎么还在饿...快去吃东西...');
});

test('normalizeReplyFormatting keeps structured list-like output intact', async () => {
  const { normalizeReplyFormatting } = await import('../src/message-workflow.js');
  const result = normalizeReplyFormatting('- 第一条\n- 第二条');

  assert.equal(result, '- 第一条\n- 第二条');
});
