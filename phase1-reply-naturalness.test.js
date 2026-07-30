import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deescalateReplyNaturalness,
  inspectReplyNaturalness,
  polishReplyNaturalness,
} from './src/reply-naturalness.js';
import { VARIANT_POOLS } from './src/reply-variants.js';

function poolTexts(name) {
  return VARIANT_POOLS[name].map((entry) => entry.text);
}

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

test('inspectReplyNaturalness allows light toxic banter but keeps severe attacks blocked', () => {
  const options = {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    messageAnalysis: { intent: 'help', sentiment: 'neutral' },
    replyPlan: { questionNeeded: true },
    personalityStrategy: { signatureMove: { key: 'sharp_answer' } },
    conversationState: { messages: [] },
  };

  for (const reply of [
    '早什么早，懒狗。',
    '菜狗又把代码写炸了？日志交出来。',
    '你脑子是真会给自己加班。先去歇会儿。',
  ]) {
    const result = inspectReplyNaturalness(reply, options);
    assert.equal(result.flags.includes('personal-attack'), false, reply);
  }

  const severe = inspectReplyNaturalness('闭嘴，蠢货。', options);
  assert.equal(severe.flags.includes('personal-attack'), true);
  assert.equal(severe.rewriteRecommended, true);
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

  assert.ok(poolTexts('deescalated-positive').includes(text), text);
  assert.doesNotMatch(text, /你每次|被讲中|责任/);
});

test('deescalateReplyNaturalness removes soft accusations and keeps at most one useful question', () => {
  const text = deescalateReplyNaturalness('会吗？刚才明明还说是因为我。具体是哪里奇怪了？', {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    messageAnalysis: { intent: 'social', sentiment: 'neutral' },
    replyPlan: { questionNeeded: true },
  });
  const inspection = inspectReplyNaturalness(text, {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    messageAnalysis: { intent: 'social', sentiment: 'neutral' },
    replyPlan: { questionNeeded: true },
    personalityStrategy: { signatureMove: { key: 'concrete_curiosity' } },
    conversationState: { messages: [] },
  });

  assert.equal(text, '具体是哪里奇怪了？');
  assert.equal(inspection.rewriteRecommended, false);
  assert.equal((text.match(/[？?]/g) || []).length, 1);
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

test('robotic acknowledgement phrases are rewritten without raising attack score', () => {
  const options = {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    messageAnalysis: { intent: 'social', sentiment: 'neutral' },
    replyPlan: { questionNeeded: false },
    personalityStrategy: { signatureMove: { key: 'observation' } },
    conversationState: { messages: [] },
  };

  for (const reply of [
    '我记下了。',
    '这句我收下了。',
    '我听到了。',
    '我知道了。',
    '收到。',
    '嗯，这句我收下了。别得意。',
  ]) {
    const result = inspectReplyNaturalness(reply, options);
    assert.equal(result.flags.includes('robotic-acknowledgement'), true, reply);
    assert.equal(result.rewriteRecommended, true, reply);
    assert.equal(result.edgeScore, 0, reply);
    const softened = deescalateReplyNaturalness(reply, options);
    assert.doesNotMatch(softened, /记下|记住|收下|听到|知道了|收到/);
  }
});
function repeatToLength(length) {
  return '今天的进度我盯着呢'.repeat(40).slice(0, length);
}

test('private length thresholds allow 96 chars for normal replies and 140 for help intent', () => {
  const base = { event: { chatType: 'private' }, route: { category: 'private_chat' } };
  const helpBase = { ...base, messageAnalysis: { intent: 'help' } };

  assert.equal(inspectReplyNaturalness(repeatToLength(96), base).flags.includes('private-too-long'), false);
  assert.equal(inspectReplyNaturalness(repeatToLength(97), base).flags.includes('private-too-long'), true);
  assert.equal(inspectReplyNaturalness(repeatToLength(139), helpBase).flags.includes('private-too-long'), false);
  assert.equal(inspectReplyNaturalness(repeatToLength(141), helpBase).flags.includes('private-too-long'), true);
});

test('over-long private replies collapse on a sentence boundary instead of mid-sentence truncation', () => {
  const first = '第一句先把结论说清楚。';
  const second = '接着这句非常长非常长地补充所有细节把私聊长度上限直接顶穿方便验证句界收束只保留第一句完整内容而不是在中途硬截断再补一个句号的行为是否已经被正确实现出来并且能够稳定复现每一次结果。';
  const output = deescalateReplyNaturalness(first + second, {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
  });

  assert.equal(output, first);
  assert.match(output, /。$/);
  assert.equal(output.includes(second.slice(0, 8)), false);
});

test('private replies without any sentence boundary are kept whole rather than hard-truncated', () => {
  const value = '这段话一口气说到底中间没有任何标点符号所以句界收束没有任何位置可以使用整段内容会被原样保留下来给你看清楚我到底想表达什么东西顺便把长度堆到远超九十六个字的私聊上限方便断言验证具体行为是否真的符合预期结果';
  assert.ok(value.length > 96);

  const output = deescalateReplyNaturalness(value, {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
  });

  assert.equal(output, value);
  assert.doesNotMatch(output, /[^。！？!?]。$/);
});

test('one question survives when the inbound message is itself a question or the plan is a followup', () => {
  const reply = '这块缓存我看过了。你要不要先跑一遍压测？';
  const route = { category: 'private_chat' };

  const inboundQuestion = deescalateReplyNaturalness(reply, {
    event: { chatType: 'private', text: '缓存要怎么处理？' },
    route,
  });
  const followupPlan = deescalateReplyNaturalness(reply, {
    event: { chatType: 'private', text: '缓存我改完了' },
    route,
    replyPlan: { type: 'followup_probe' },
  });
  const plainStatement = deescalateReplyNaturalness(reply, {
    event: { chatType: 'private', text: '缓存我改完了' },
    route,
  });

  assert.match(inboundQuestion, /压测？$/);
  assert.match(followupPlan, /压测？$/);
  assert.doesNotMatch(plainStatement, /[？?]/);
  assert.equal(plainStatement, '这块缓存我看过了。');
});
test('single light jab stays allowed while stacked belittling is flagged and trimmed', () => {
  const options = {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    messageAnalysis: { intent: 'help', sentiment: 'neutral' },
    replyPlan: { questionNeeded: false },
    personalityStrategy: { signatureMove: { key: 'sharp_answer' } },
    conversationState: { messages: [] },
  };

  for (const reply of ['早什么早，懒狗。', '菜狗又把代码写炸了？日志交出来。']) {
    const result = inspectReplyNaturalness(reply, options);
    assert.equal(result.flags.includes('stacked-belittling'), false, reply);
    assert.equal(result.rewriteRecommended, false, reply);
  }

  const stacked = inspectReplyNaturalness('懒狗，菜狗，你这脑子进水了吧。先把日志发我。', options);
  assert.equal(stacked.flags.includes('stacked-belittling'), true);
  assert.equal(stacked.rewriteRecommended, true);

  const trimmed = deescalateReplyNaturalness('懒狗，菜狗，你这脑子进水了吧。先把日志发我。', options);
  assert.match(trimmed, /先把日志发我/);
  assert.equal(inspectReplyNaturalness(trimmed, options).flags.includes('stacked-belittling'), false);
  assert.equal(trimmed.includes('菜狗'), false);
});
