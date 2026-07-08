import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateStyleScenario,
  summarizeStyleEvalResults,
} from './evals/run-style-evals.js';

const styleExamples = [{
  id: 'private-comfort-short',
  scene: 'private',
  intent: 'help',
  emotion: 'SAD',
  userText: '今晚有点撑不住',
  humanReply: '先慢一点，我在听。你不用一下子讲完。',
  tags: ['comfort', 'private'],
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
    reply: '先慢一点，我在听。你不用一下子讲完。',
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
