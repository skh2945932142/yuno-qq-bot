import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectExperienceSignals,
  generateExperienceIdeas,
  renderExperienceIdeasReport,
} from './scripts/experience-ideas.js';
import {
  collectDevHealthSignals,
  renderDevHealthReport,
} from './scripts/dev-health-report.js';
import {
  evaluateScenario,
  renderExperienceScorecard,
  summarizeExperience,
} from './evals/run-evals.js';

test('experience radar generates concrete product ideas from repo signals', () => {
  const signals = collectExperienceSignals();
  assert.equal(signals.hasEvalScorecard, true);
  signals.hasEvalScorecard = false;
  const ideas = generateExperienceIdeas(signals);
  const report = renderExperienceIdeasReport(signals, ideas);

  assert.ok(signals.evalScenarios >= 30);
  assert.ok(ideas.length >= 5);
  assert.match(report, /Yuno Experience Radar/);
  assert.match(report, /体验评分卡|experience/i);
  assert.match(report, /Concrete next step/);
});

test('development health report includes CI and security automation signals', () => {
  const signals = collectDevHealthSignals();
  const report = renderDevHealthReport(signals);

  assert.equal(signals.hasSecurityAudit, true);
  assert.equal(signals.hasSecretScan, true);
  assert.equal(signals.hasCircleCi, true);
  assert.match(report, /Yuno Development Health/);
  assert.match(report, /Security audit script/);
  assert.match(report, /CircleCI config present/);
});

test('eval runner produces an experience scorecard for product-quality feedback', async () => {
  const scenario = {
    id: 'scorecard-private-chat',
    type: 'analysis',
    event: {
      post_type: 'message',
      message_type: 'private',
      user_id: '10001',
      self_id: '20002',
      raw_message: '陪我聊一会',
      sender: { nickname: 'alice' },
    },
    expected: { shouldRespond: true, taskType: 'chat', taskCategory: 'private_chat' },
    expectedExperience: {
      naturalness: 'companion-chat',
      memoryUse: 'optional',
      falseTrigger: 'must_reply',
      replyLength: 'medium',
    },
  };

  const result = await evaluateScenario(scenario);
  const summary = summarizeExperience([result]);
  const report = renderExperienceScorecard([result]);

  assert.equal(result.error, null);
  assert.equal(result.experience.expected.replyLength, 'medium');
  assert.equal(result.experience.scores.falseTrigger, 1);
  assert.equal(summary.overall, 1);
  assert.match(report, /Yuno Eval Experience Scorecard/);
  assert.match(report, /Naturalness/);
  assert.match(report, /Reply length fit/);
});

test('eval scorecard highlights missing memory continuity expectations', async () => {
  const scenario = {
    id: 'scorecard-memory-gap',
    type: 'analysis',
    event: {
      post_type: 'message',
      message_type: 'private',
      user_id: '10001',
      self_id: '20002',
      raw_message: '然后呢？',
      sender: { nickname: 'alice' },
    },
    expected: { shouldRespond: true, taskType: 'chat', taskCategory: 'follow_up' },
    expectedExperience: {
      naturalness: 'follow-up-continuity',
      memoryUse: 'expected',
      falseTrigger: 'must_reply',
      replyLength: 'medium',
    },
  };

  const result = await evaluateScenario(scenario);

  assert.equal(result.error, null);
  assert.equal(result.experience.scores.memoryUse, 0);
  assert.match(result.experience.notes.join(' '), /no conversation memory cue/);
});
