import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceEmojiBudget } from '../src/message-workflow.js';

test('enforceEmojiBudget removes all emoji when budget is zero', () => {
  const result = enforceEmojiBudget('hello😊💞', {
    emojiBudget: 0,
    emojiStyle: 'none',
  });

  assert.equal(result, 'hello');
});

test('enforceEmojiBudget keeps only one allowed soft emoji in affectionate mode', () => {
  const result = enforceEmojiBudget('welcome💞✨', {
    emojiBudget: 1,
    emojiStyle: 'soft',
  });

  assert.equal(result, 'welcome💞');
});

test('enforceEmojiBudget collapses blank lines into a single newline', () => {
  const result = enforceEmojiBudget('line1\n\nline2\n\n\nline3', {
    emojiBudget: 0,
    emojiStyle: 'none',
  });

  assert.equal(result, 'line1\nline2\nline3');
});
