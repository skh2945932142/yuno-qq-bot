import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectReplyNaturalness,
  polishReplyNaturalness,
} from './src/reply-naturalness.js';

test('inspectReplyNaturalness flags AI disclaimers and canned empathy', () => {
  const result = inspectReplyNaturalness('作为一个 AI，我理解你的感受。总结一下：你需要先休息。', {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
  });

  assert.deepEqual(result.flags, ['ai-disclaimer', 'canned-empathy', 'summary-preface']);
  assert.equal(result.ok, false);
});

test('polishReplyNaturalness removes obvious AI-style prefaces without dropping the answer', () => {
  const text = polishReplyNaturalness('作为一个 AI，我理解你的感受。总结一下：你需要先休息。', {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
  });

  assert.equal(text, '你需要先休息。');
  assert.doesNotMatch(text, /作为一个 AI|我理解你的感受|总结一下/);
});

test('inspectReplyNaturalness flags structured long group chat replies', () => {
  const result = inspectReplyNaturalness('1. 先这样。\n2. 然后那样。\n3. 最后总结。', {
    event: { chatType: 'group' },
    route: { category: 'group_chat' },
  });

  assert.equal(result.flags.includes('group-structured-panel'), true);
});
