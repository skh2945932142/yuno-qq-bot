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
  assert.equal(strategy.possessiveness, 'medium');
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
  assert.match(strategy.promptHints.join(' '), /群聊里短接话/);
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
  assert.match(strategy.promptHints.join(' '), /先安抚|追问最多一个/);
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
  assert.match(strategy.promptHints.join(' '), /不能攻击第三方/);
  assert.match(strategy.forbiddenMoves.join(' '), /现实威胁|羞辱|攻击第三方/);
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

  assert.equal(normal.signatureMove.key, 'pattern_notice');
  assert.equal(playful.signatureMove.key, 'dry_tease');
  assert.equal(factual.signatureMove.key, 'sharp_answer');
});
