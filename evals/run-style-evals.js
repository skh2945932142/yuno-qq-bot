import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectReplyNaturalness } from '../src/reply-naturalness.js';
import { retrieveReplyStyleExamples } from '../src/reply-style-retriever.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const scenariosPath = path.join(__dirname, 'reply-style-scenarios.json');

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

async function loadScenarios() {
  return JSON.parse(await fs.readFile(scenariosPath, 'utf8'));
}

function defaultContext(scenario = {}) {
  const context = scenario.context || {};
  return {
    event: { chatType: 'private', ...(context.event || {}) },
    route: { category: context.event?.chatType === 'group' ? 'group_chat' : 'private_chat', ...(context.route || {}) },
    analysis: {
      intent: 'chat',
      sentiment: 'neutral',
      ruleSignals: [],
      topics: [],
      ...(context.analysis || {}),
    },
    emotionResult: { emotion: 'CALM', ...(context.emotionResult || {}) },
    replyPlan: context.replyPlan || null,
    replyLengthProfile: context.replyLengthProfile || { promptProfile: 'standard' },
  };
}

function buildNotes({ naturalness, styleExamples, expected }) {
  const notes = [];
  if (naturalness.flags.length > expected.maxNaturalnessFlags) {
    notes.push(`naturalness flags=${naturalness.flags.join(',') || 'none'}`);
  }
  if (styleExamples.length < expected.minStyleExamples) {
    notes.push(`style examples=${styleExamples.length}`);
  }
  return notes;
}

export async function evaluateStyleScenario(scenario, deps = {}) {
  const context = defaultContext(scenario);
  const expected = {
    maxNaturalnessFlags: 0,
    minStyleExamples: 0,
    ...(scenario.expected || {}),
  };
  const naturalness = inspectReplyNaturalness(scenario.reply || '', {
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
  const notes = buildNotes({ naturalness, styleExamples, expected });
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
  const scenarios = await loadScenarios();
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
