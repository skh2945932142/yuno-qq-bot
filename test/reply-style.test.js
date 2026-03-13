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
