import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectReplyNaturalness } from '../src/reply-naturalness.js';
import { retrieveReplyStyleExamples } from '../src/reply-style-retriever.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const scenariosPath = path.join(__dirname, 'reply-style-scenarios.json');
export const DEFAULT_FORBIDDEN_REPLY_PHRASES = [
  '我理解你的感受',
  '我能理解你的感受',
  '先不逼你解释',
  '你选一个',
  '最耗你的',
  '我从你选的那块接',
  '还有什么需要帮助',
];

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    reportPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') {
      args.reportPath = argv[index + 1] || path.join('reports', 'eval-reply-style.md');
      index += 1;
    } else if (arg.startsWith('--report=')) {
      args.reportPath = arg.slice('--report='.length);
    }
  }

  return args;
}

export async function loadStyleScenarios() {
  return JSON.parse(await fs.readFile(scenariosPath, 'utf8'));
}

export function buildStyleEvalContext(scenario = {}) {
  const context = scenario.context || {};
  const isGroup = context.event?.chatType === 'group';
  return {
    event: { chatType: 'private', ...(context.event || {}) },
    route: { category: isGroup ? 'group_chat' : 'private_chat', ...(context.route || {}) },
    analysis: {
      intent: 'chat',
      sentiment: 'neutral',
      ruleSignals: [],
      topics: [],
      ...(context.analysis || {}),
    },
    emotionResult: { emotion: 'CALM', ...(context.emotionResult || {}) },
    replyPlan: context.replyPlan || null,
    replyLengthProfile: {
      tier: 'balanced',
      maxTokens: isGroup ? 180 : 240,
      historyLimit: 4,
      promptProfile: 'standard',
      performanceProfile: 'standard_chat',
      temperature: 0.72,
      reasoningEffort: 'low',
      guidance: isGroup ? '群聊短接话。' : '私聊一到两句。',
      ...(context.replyLengthProfile || {}),
    },
    knowledge: context.knowledge || { documents: [] },
  };
}

function includesAny(value, patterns = []) {
  const text = String(value || '');
  return patterns.some((pattern) => text.includes(String(pattern || '')));
}

function buildNotes({ reply, naturalness, styleExamples, expected }) {
  const notes = [];
  if (naturalness.flags.length > expected.maxNaturalnessFlags) {
    notes.push(`naturalness flags=${naturalness.flags.join(',') || 'none'}`);
  }
  for (const flag of expected.requiredNaturalnessFlags) {
    if (!naturalness.flags.includes(flag)) notes.push(`missing naturalness flag=${flag}`);
  }
  if (styleExamples.length < expected.minStyleExamples) {
    notes.push(`style examples=${styleExamples.length}`);
  }
  for (const tag of expected.requiredExampleTags) {
    if (!styleExamples.some((example) => example.tags?.includes(tag))) {
      notes.push(`missing style tag=${tag}`);
    }
  }
  const forbiddenReplyPhrases = expected.allowMechanicalPhrases
    ? expected.forbiddenReplyPhrases
    : [...DEFAULT_FORBIDDEN_REPLY_PHRASES, ...expected.forbiddenReplyPhrases];
  const matchedForbidden = forbiddenReplyPhrases.filter((phrase) => String(reply || '').includes(phrase));
  if (matchedForbidden.length > 0) {
    notes.push(`forbidden reply phrases=${matchedForbidden.join(',')}`);
  }
  if (expected.requiredReplyAny.length > 0 && !includesAny(reply, expected.requiredReplyAny)) {
    notes.push(`missing reply signal=${expected.requiredReplyAny.join('/')}`);
  }
  if (Number.isFinite(expected.maxReplyLength) && String(reply || '').length > expected.maxReplyLength) {
    notes.push(`reply length=${String(reply || '').length}`);
  }
  if (styleExamples.some((example) => includesAny(example.humanReply, DEFAULT_FORBIDDEN_REPLY_PHRASES))) {
    notes.push('retrieved mechanical style example');
  }
  return notes;
}

export async function evaluateStyleScenario(scenario, deps = {}) {
  const context = buildStyleEvalContext(scenario);
  const expected = {
    maxNaturalnessFlags: 0,
    minStyleExamples: 0,
    requiredNaturalnessFlags: [],
    requiredExampleTags: [],
    forbiddenReplyPhrases: [],
    requiredReplyAny: [],
    maxReplyLength: null,
    allowMechanicalPhrases: false,
    ...(scenario.expected || {}),
  };
  const reply = scenario.reply || '';
  const naturalness = inspectReplyNaturalness(reply, {
    event: context.event,
    route: context.route,
    replyLengthProfile: context.replyLengthProfile,
  });
  const styleExamples = await retrieveReplyStyleExamples({
    event: context.event,
    route: context.route,
    analysis: context.analysis,
    emotionResult: context.emotionResult,
    replyPlan: context.replyPlan,
    userTurn: scenario.input || '',
    replyLengthProfile: context.replyLengthProfile,
  }, deps);
  const notes = buildNotes({ reply, naturalness, styleExamples, expected });
  const passed = notes.length === 0;

  return {
    id: scenario.id,
    passed,
    naturalness,
    styleExamples,
    notes,
  };
}

export function summarizeStyleEvalResults(results = []) {
  const count = results.length;
  const passed = results.filter((result) => result.passed).length;
  return {
    count,
    passed,
    failed: count - passed,
    passRate: count > 0 ? passed / count : 0,
  };
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function renderReport(results) {
  const summary = summarizeStyleEvalResults(results);
  const lines = [
    '# Yuno Reply Style Eval',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Scenarios: ${summary.count}`,
    `- Passed: ${summary.passed}/${summary.count}`,
    `- Pass rate: ${formatPercent(summary.passRate)}`,
    '',
    '## Scenario Scores',
    '',
    '| Scenario | Status | Naturalness Flags | Style Examples | Notes |',
    '|---|---|---:|---:|---|',
  ];

  for (const result of results) {
    lines.push([
      result.id,
      result.passed ? 'PASS' : 'FAIL',
      result.naturalness.flags.length,
      result.styleExamples.length,
      result.notes.join('; ') || '-',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  return lines.join('\n');
}

async function writeReport(reportPath, results) {
  const absolutePath = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(repoRoot, reportPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, renderReport(results), 'utf8');
  return absolutePath;
}

async function main() {
  const args = parseArgs();
  const scenarios = await loadStyleScenarios();
  const results = [];

  for (const scenario of scenarios) {
    const result = await evaluateStyleScenario(scenario);
    results.push(result);
    console.log(`[${result.passed ? 'PASS' : 'FAIL'}] ${result.id}${result.notes.length ? `: ${result.notes.join('; ')}` : ''}`);
  }

  const summary = summarizeStyleEvalResults(results);
  console.log(`Reply style eval: ${summary.passed}/${summary.count} passed, passRate=${formatPercent(summary.passRate)}.`);

  if (args.reportPath) {
    const writtenPath = await writeReport(args.reportPath, results);
    console.log(`Reply style eval report written to ${path.relative(repoRoot, writtenPath)}`);
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('Reply style eval failed:', error.message);
    process.exit(1);
  });
}

export {
  renderReport,
};
