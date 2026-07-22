import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deescalateReplyNaturalness,
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

test('polishReplyNaturalness replaces generic companionship templates for direct attention', () => {
  const text = polishReplyNaturalness('嗯，我在这儿。先说哪件？', {
    event: { chatType: 'private', rawText: '陪我聊会儿，今天有点累' },
    route: { category: 'private_chat' },
    personalityStrategy: { signatureMove: { key: 'direct_attention' } },
  });

  assert.equal(text, '行，这会儿先听你的。先挑今天最耗你的那一件说。');
});

test('polishReplyNaturalness leaves normal direct attention wording unchanged', () => {
  const text = polishReplyNaturalness('行，这会儿我先听你的。你从最烦的那一件开始。', {
    event: { chatType: 'private', rawText: '陪我聊会儿' },
    route: { category: 'private_chat' },
    personalityStrategy: { signatureMove: { key: 'direct_attention' } },
  });

  assert.equal(text, '行，这会儿我先听你的。你从最烦的那一件开始。');
});

test('production accusatory replies are rejected for motive attribution and interrogation', () => {
  const replies = [
    '你自己硬要凑过来，倒是一秒就把账全算到我头上。你这是在怪我，还是单纯想找个借口赖着？',
    '又不是第一天知道我脾气怪。嫌我怪还非要凑这么近，你就不觉得自己更奇怪吗？',
    '明明口口声声说我脾气怪，靠过来的动作倒是一点犹豫都没有。你就这么喜欢往冷冰冰的地方贴吗？',
    '这种话倒是说得越来越顺口了。你就这么确定，每次拿这句话当理由都能在我这蒙混过关？',
    '说得这么确定。你每次被讲中就换成这种认真的语气，把揣测你的责任全扔给我。你就那么肯定我不会想多？',
  ];

  for (const reply of replies) {
    const result = inspectReplyNaturalness(reply, {
      event: { chatType: 'private' },
      route: { category: 'private_chat' },
      messageAnalysis: { intent: 'social', sentiment: 'positive' },
      replyPlan: { questionNeeded: false },
      personalityStrategy: { signatureMove: { key: 'pleased_restraint' } },
      conversationState: { messages: [] },
    });
    assert.equal(result.rewriteRecommended, true, reply);
    assert.equal(result.edgeScore >= 2, true, reply);
  }
});

test('one intentional mild edge is allowed but cannot repeat after an edged turn', () => {
  const options = {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral' },
    replyPlan: { questionNeeded: false },
    personalityStrategy: { signatureMove: { key: 'mild_edge' } },
  };
  const allowed = inspectReplyNaturalness('你倒是很会挑时候。算了，这次让你靠一会儿。', {
    ...options,
    conversationState: { messages: [] },
  });
  const repeated = inspectReplyNaturalness('你怎么还来这一套。先坐好。', {
    ...options,
    conversationState: {
      messages: [{ role: 'assistant', content: '这次算你会挑时候。', edgeScore: 1 }],
    },
  });

  assert.equal(allowed.rewriteRecommended, false);
  assert.equal(repeated.flags.includes('repeated-edge'), true);
  assert.equal(repeated.rewriteRecommended, true);
});

test('safe restrained warmth is not mistaken for an accusation', () => {
  const result = inspectReplyNaturalness('我知道。可你还愿意靠过来，那我就稍微收一点。', {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    messageAnalysis: { intent: 'social', sentiment: 'positive' },
    replyPlan: { questionNeeded: false },
    personalityStrategy: { signatureMove: { key: 'reciprocal_warmth' } },
    conversationState: { messages: [] },
  });

  assert.equal(result.rewriteRecommended, false);
  assert.equal(result.edgeScore, 0);
});

test('deescalateReplyNaturalness never returns unsupported motive attribution', () => {
  const text = deescalateReplyNaturalness('你每次被讲中就换语气，把责任都扔给我。', {
    messageAnalysis: { intent: 'social', sentiment: 'positive' },
  });

  assert.equal(text, '嗯，这句我收下了。别得意。');
  assert.doesNotMatch(text, /你每次|被讲中|责任/);
});

test('polishReplyNaturalness removes repeated emoji when the style policy suppresses it', () => {
  const text = polishReplyNaturalness('好吧，那就听你的✨', {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    personalityStrategy: { emojiPolicy: { allowed: false } },
    conversationState: { messages: [{ role: 'assistant', content: '刚才已经笑过啦✨' }] },
  });

  assert.equal(text, '好吧，那就听你的');
});
