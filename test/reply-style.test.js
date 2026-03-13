import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceEmojiBudget } from '../src/workflows/group-message-workflow.js';

test('enforceEmojiBudget removes all emoji when budget is zero', () => {
  const result = enforceEmojiBudget('你现在才来呀🥺💕', {
    emojiBudget: 0,
    emojiStyle: 'none',
  });

  assert.equal(result, '你现在才来呀');
});

test('enforceEmojiBudget keeps only one allowed soft emoji in affectionate mode', () => {
  const result = enforceEmojiBudget('你终于来了💕🥺✨', {
    emojiBudget: 1,
    emojiStyle: 'soft',
  });

  assert.equal(result, '你终于来了💕');
});

test('enforceEmojiBudget collapses blank lines into a single newline', () => {
  const result = enforceEmojiBudget('第一句\n\n第二句\n\n\n第三句', {
    emojiBudget: 0,
    emojiStyle: 'none',
  });

  assert.equal(result, '第一句\n第二句\n第三句');
});
