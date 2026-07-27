import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateStyleScenario,
  summarizeStyleEvalResults,
} from './evals/run-style-evals.js';
import {
  evaluateModelReply,
  parseStructuredReplyText,
} from './evals/run-style-model-evals.js';

const styleExamples = [{
  id: 'private-comfort-short',
  scene: 'private',
  intent: 'help',
  emotion: 'SAD',
  userText: '今晚有点撑不住',
  humanReply: '你又把自己折腾没电了吧。先去躺会儿，别硬撑。',
  tags: ['comfort', 'private', 'roast-then-care', 'toxic-banter'],
  quality: 0.96,
}];

test('evaluateStyleScenario fails replies with obvious AI naturalness flags', async () => {
  const result = await evaluateStyleScenario({
    id: 'private-ai-cliche',
    input: '我今晚有点焦虑',
    reply: '作为一个 AI，我理解你的感受。总结一下：你需要先休息。',
    context: {
      event: { chatType: 'private' },
      route: { category: 'private_chat' },
      analysis: { intent: 'help', sentiment: 'negative', ruleSignals: ['private-chat'] },
      emotionResult: { emotion: 'SAD' },
      replyPlan: { interpretation: { needsEmpathy: true } },
    },
    expected: {
      maxNaturalnessFlags: 0,
      minStyleExamples: 1,
    },
  }, {
    examples: styleExamples,
  });

  assert.equal(result.passed, false);
  assert.equal(result.naturalness.flags.includes('ai-disclaimer'), true);
  assert.equal(result.styleExamples.length, 1);
});

test('summarizeStyleEvalResults reports aggregate pass rate', async () => {
  const passing = await evaluateStyleScenario({
    id: 'private-natural',
    input: '我今晚有点焦虑',
    reply: '你脑子是真会给自己加班。先把最急的那件扔给我。',
    context: {
      event: { chatType: 'private' },
      route: { category: 'private_chat' },
      analysis: { intent: 'help', sentiment: 'negative', ruleSignals: ['private-chat'] },
      emotionResult: { emotion: 'SAD' },
      replyPlan: { interpretation: { needsEmpathy: true } },
    },
    expected: {
      maxNaturalnessFlags: 0,
      minStyleExamples: 1,
    },
  }, {
    examples: styleExamples,
  });

  const summary = summarizeStyleEvalResults([passing]);
  assert.equal(passing.passed, true);
  assert.equal(summary.count, 1);
  assert.equal(summary.passed, 1);
  assert.equal(summary.passRate, 1);
});

test('parseStructuredReplyText extracts text from strict JSON output', () => {
  assert.equal(parseStructuredReplyText('{"text":"菜狗，日志贴来。","sendVoice":false,"voiceText":""}'), '菜狗，日志贴来。');
});

test('evaluateModelReply accepts toxic help with useful content and rejects counseling tone', () => {
  const scenario = {
    expected: {
      requiredReplyAny: ['日志', '报错'],
      maxReplyLength: 90,
    },
  };
  const promptContext = {
    event: { chatType: 'private' },
    route: { category: 'private_chat' },
    messageAnalysis: { intent: 'help', sentiment: 'neutral' },
    replyPlan: { questionNeeded: true },
    personalityStrategy: { signatureMove: { key: 'sharp_answer' } },
    conversationState: { messages: [] },
    context: { replyLengthProfile: { promptProfile: 'standard' } },
  };

  const passing = evaluateModelReply(scenario, '菜狗又写炸了？把报错日志贴来。', promptContext);
  const failing = evaluateModelReply(scenario, '我理解你的感受。还有什么需要帮助的吗？', promptContext);

  assert.equal(passing.passed, true);
  assert.equal(failing.passed, false);
  assert.match(failing.notes.join(' '), /mechanical|missing content/);
});
