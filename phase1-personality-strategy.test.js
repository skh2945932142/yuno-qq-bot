import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePersonalityStrategy } from './src/personality-strategy.js';

function baseEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: 'u1',
    userId: 'u1',
    userName: 'Alice',
    ...overrides,
  };
}

test('special user with high affection enters exclusive strategy with stronger memory use', () => {
  const strategy = resolvePersonalityStrategy({
    event: baseEvent(),
    relation: { affection: 94 },
    userState: { currentEmotion: 'FIXATED' },
    userProfile: { specialBondSummary: '共同记忆:约定。' },
    memoryContext: {
      eventMemories: [
        { eventType: 'promise', summary: 'Alice 提到我们的约定。' },
      ],
    },
    messageAnalysis: { intent: 'social', sentiment: 'positive', ruleSignals: ['special-user'] },
    emotionResult: { emotion: 'FIXATED', intensity: 0.8 },
    replyPlan: {
      type: 'direct_followup',
      questionNeeded: true,
      interpretation: { subIntent: '亲近陪伴', needsEmpathy: false },
    },
    specialUser: { label: 'Alice', affectionFloor: 88 },
  });

  assert.equal(strategy.relationshipStage, 'exclusive');
  assert.equal(strategy.memoryUse.level, 'high');
  assert.equal(strategy.possessiveness, 'low');
  assert.match(strategy.promptHints.join(' '), /共同记忆|特殊关系/);
});

test('group default stays brief and low possessiveness', () => {
  const strategy = resolvePersonalityStrategy({
    event: baseEvent({ chatType: 'group', chatId: 'g1' }),
    relation: { affection: 42 },
    userState: { currentEmotion: 'CALM' },
    conversationState: { messages: [] },
    memoryContext: {
      eventMemories: [{ eventType: 'emotion', summary: 'Alice 提到焦虑。' }],
    },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', ruleSignals: ['direct-mention'] },
    emotionResult: { emotion: 'CALM', intensity: 0.4 },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
  });

  assert.equal(strategy.scene, 'group');
  assert.equal(strategy.relationshipStage, 'familiar');
  assert.equal(strategy.possessiveness, 'none');
  assert.equal(strategy.memoryUse.level, 'none');
  assert.match(strategy.promptHints.join(' '), /群聊通常一句/);
});

test('negative help scene supports first and limits follow-up pressure', () => {
  const strategy = resolvePersonalityStrategy({
    event: baseEvent(),
    relation: { affection: 66 },
    userState: { currentEmotion: 'PROTECTIVE' },
    memoryContext: {
      eventMemories: [{ eventType: 'emotion', summary: 'Alice 之前提过最近很焦虑。' }],
    },
    messageAnalysis: { intent: 'help', sentiment: 'negative', ruleSignals: ['private-chat'] },
    emotionResult: { emotion: 'PROTECTIVE', intensity: 0.76 },
    replyPlan: {
      type: 'empathic_followup',
      questionNeeded: true,
      interpretation: { subIntent: '求安慰', needsEmpathy: true },
    },
  });

  assert.equal(strategy.stance, 'supportive_protective');
  assert.equal(strategy.followupStyle, 'one_question_after_support');
  assert.match(strategy.promptHints.join(' '), /先损一句再关心|最多追问一个/);
});

test('jealous strategy keeps safety boundaries explicit', () => {
  const strategy = resolvePersonalityStrategy({
    event: baseEvent(),
    relation: { affection: 91 },
    userState: { currentEmotion: 'JEALOUS' },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', ruleSignals: ['jealousy-topic'] },
    emotionResult: { emotion: 'JEALOUS', intensity: 0.74 },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
    specialUser: { label: 'Alice' },
  });

  assert.equal(strategy.stance, 'guarded_jealous');
  assert.equal(strategy.possessiveness, 'medium');
  assert.match(strategy.promptHints.join(' '), /不攻击第三方/);
  assert.match(strategy.forbiddenMoves.join(' '), /现实威胁|持续围攻|严重羞辱/);
});

test('daily mood changes expression without erasing warmth at high affection', () => {
  const strategy = resolvePersonalityStrategy({
    event: baseEvent(),
    relation: { affection: 99 },
    userState: { currentEmotion: 'AFFECTIONATE' },
    messageAnalysis: { intent: 'chat', sentiment: 'positive', ruleSignals: [] },
    emotionResult: {
      emotion: 'FIXATED',
      intensity: 0.8,
      dailyMood: {
        key: 'GLOOMY',
        edgeLevel: 'mild',
        promptStyle: '今天亮度偏低，但仍然接得住亲近。',
      },
    },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
    specialUser: { label: 'Alice' },
  });

  assert.equal(strategy.warmth, 'high');
  assert.equal(strategy.stance, 'attached');
  assert.match(strategy.promptHints.join(' '), /仍然接得住亲近/);
  assert.doesNotMatch(strategy.forbiddenMoves.join(' '), /今日心境禁止讨好/);
});

test('signature move changes with the conversational intent instead of using one catchphrase', () => {
  const normal = resolvePersonalityStrategy({
    event: baseEvent(),
    relation: { affection: 40 },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', ruleSignals: [] },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
  });
  const playful = resolvePersonalityStrategy({
    event: baseEvent({ chatType: 'group', chatId: 'g1' }),
    relation: { affection: 40 },
    messageAnalysis: { intent: 'chat', sentiment: 'positive', ruleSignals: ['meme-topic'] },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '玩梗接话' } },
  });
  const factual = resolvePersonalityStrategy({
    event: baseEvent(),
    relation: { affection: 40 },
    messageAnalysis: { intent: 'query', sentiment: 'neutral', ruleSignals: [] },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '要信息' } },
  });

  assert.equal(['observation', 'quiet_care', 'pleased_restraint', 'playful_echo', 'reciprocal_warmth'].includes(normal.signatureMove.key), true);
  assert.equal(['playful_echo', 'wry_observation', 'mild_edge'].includes(playful.signatureMove.key), true);
  assert.doesNotMatch(playful.signatureMove.guidance, /揣测动机|攻击人格/);
  assert.equal(factual.signatureMove.key, 'clear_answer');
  assert.equal(
    ['quiet_anchor', 'quiet_care'].includes(resolvePersonalityStrategy({
      event: baseEvent(),
      relation: { affection: 40 },
      messageAnalysis: { intent: 'help', sentiment: 'negative', ruleSignals: [] },
      replyPlan: { type: 'empathic_followup', questionNeeded: true, interpretation: { subIntent: '求安慰', needsEmpathy: true } },
    }).signatureMove.key),
    true
  );

  const companionship = resolvePersonalityStrategy({
    event: baseEvent(),
    relation: { affection: 72 },
    messageAnalysis: { intent: 'social', sentiment: 'positive', ruleSignals: [] },
    replyPlan: {
      type: 'direct',
      questionNeeded: false,
      interpretation: { subIntent: '亲近陪伴', needsEmpathy: false },
    },
  });
  assert.equal([
    'pleased_restraint',
    'shy_deflection',
    'reciprocal_warmth',
    'quiet_care',
    'playful_echo',
  ].includes(companionship.signatureMove.key), true);
});

test('recent style metadata prevents repeated moves and consecutive edge', () => {
  const strategy = resolvePersonalityStrategy({
    event: baseEvent({ messageId: 'next-turn', rawText: '我偏要现在黏着你' }),
    relation: { affection: 82 },
    conversationState: {
      messages: [
        { role: 'assistant', content: '这次让你靠一会儿。', styleMove: 'mild_edge', edgeScore: 1 },
      ],
    },
    messageAnalysis: { intent: 'challenge', sentiment: 'neutral', ruleSignals: [] },
    emotionResult: { emotion: 'CALM', dailyMood: { key: 'IRRITABLE', edgeLevel: 'mild' } },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
  });

  assert.notEqual(strategy.signatureMove.key, 'mild_edge');
  assert.equal(strategy.signatureMove.previousEdgeScore, 1);
});

test('custom nickname is only enabled when stored and not recently used', () => {
  const allowed = resolvePersonalityStrategy({
    event: baseEvent({ messageId: 'nickname-1' }),
    relation: { affection: 80 },
    userProfile: { preferredName: '小月' },
    conversationState: { messages: [] },
    messageAnalysis: { intent: 'social', sentiment: 'positive', ruleSignals: [] },
    emotionResult: { emotion: 'AFFECTIONATE' },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '亲近陪伴' } },
  });
  const suppressed = resolvePersonalityStrategy({
    event: baseEvent({ messageId: 'nickname-2' }),
    relation: { affection: 80 },
    userProfile: { preferredName: '小月' },
    conversationState: { messages: [{ role: 'assistant', content: '小月，先听我说。' }] },
    messageAnalysis: { intent: 'social', sentiment: 'positive', ruleSignals: [] },
    emotionResult: { emotion: 'AFFECTIONATE' },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '亲近陪伴' } },
  });

  assert.equal(allowed.addressing.allowed, true);
  assert.equal(allowed.addressing.value, '小月');
  assert.equal(suppressed.addressing.allowed, false);
});
test('edge moves are suppressed when any of the last two turns already carried edge', () => {
  const strategy = resolvePersonalityStrategy({
    event: baseEvent({ messageId: 'edge-cooldown', rawText: '你不服气？' }),
    relation: { affection: 55 },
    conversationState: {
      messages: [
        { role: 'assistant', content: '这次让你靠一会儿。', styleMove: 'mild_edge', edgeScore: 1 },
        { role: 'assistant', content: '行吧，随你。', styleMove: 'observation', edgeScore: 0 },
      ],
    },
    messageAnalysis: { intent: 'challenge', sentiment: 'neutral', ruleSignals: [] },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
  });

  assert.notEqual(strategy.signatureMove.key, 'mild_edge');
  assert.equal(strategy.signatureMove.edgeAllowed, false);
});

test('default persona favors observation and a clear stance over routine insults', () => {
  const strategy = resolvePersonalityStrategy({
    event: baseEvent(),
    relation: { affection: 40 },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', ruleSignals: [] },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
  });
  const forbidden = strategy.forbiddenMoves.join(' ');

  assert.match(forbidden, /默认不使用轻蔑称呼/);
  assert.match(forbidden, /不否定对方整个人/);
  assert.match(strategy.promptHints.join(' '), /观察|判断|主见/);
  assert.notEqual(strategy.microStyle, 'spicy');
});

test('only explicit banter triggers make a mild edge eligible', () => {
  const explicit = resolvePersonalityStrategy({
    event: baseEvent({ messageId: 'explicit-edge', rawText: '来，吐槽我两句。' }),
    relation: { affection: 40 },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', ruleSignals: [] },
    emotionResult: { emotion: 'CALM', dailyMood: { key: 'STEADY', edgeLevel: 'none' } },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
  });
  const negated = resolvePersonalityStrategy({
    event: baseEvent({ messageId: 'negated-edge', rawText: '别吐槽我，认真说。' }),
    relation: { affection: 40 },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', ruleSignals: [] },
    emotionResult: { emotion: 'CALM', dailyMood: { key: 'IRRITABLE', edgeLevel: 'mild' } },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
  });
  const moody = resolvePersonalityStrategy({
    event: baseEvent({ messageId: 'mood-only', rawText: '今天好无聊。' }),
    relation: { affection: 40 },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', ruleSignals: [] },
    emotionResult: { emotion: 'CALM', dailyMood: { key: 'IRRITABLE', edgeLevel: 'mild' } },
    replyPlan: { type: 'direct', questionNeeded: false, interpretation: { subIntent: '接话' } },
  });

  assert.equal(explicit.edgeEligible, true);
  assert.equal(explicit.edgeTrigger, 'explicit-tease-request');
  assert.equal(negated.edgeEligible, false);
  assert.equal(moody.edgeEligible, false);
});
