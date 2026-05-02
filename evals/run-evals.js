import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTrigger } from '../src/message-analysis.js';
import { validateOnebotMessageEvent } from '../src/adapters/onebot-event.js';
import { planIncomingTask } from '../src/task-router.js';
import { parseCommand } from '../src/command-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const scenariosPath = path.join(__dirname, 'scenarios.json');

async function loadScenarios() {
  const raw = await fs.readFile(scenariosPath, 'utf8');
  return JSON.parse(raw);
}

function parseEvalArgs(argv = process.argv.slice(2)) {
  const args = {
    reportPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') {
      args.reportPath = argv[index + 1] || path.join('reports', 'eval-experience.md');
      index += 1;
    } else if (arg.startsWith('--report=')) {
      args.reportPath = arg.slice('--report='.length);
    }
  }

  return args;
}

function hasConversationMemoryCue(scenario) {
  const state = scenario.context?.conversationState;
  return Boolean(
    state?.rollingSummary
      || (Array.isArray(state?.messages) && state.messages.length > 0),
  );
}

function inferExpectedExperience(scenario) {
  const explicit = scenario.expectedExperience || {};
  const taskCategory = scenario.expected?.taskCategory;
  const taskType = scenario.expected?.taskType;
  const shouldRespond = scenario.expected?.shouldRespond;
  const rawMessage = scenario.event?.raw_message || '';
  const hasHistory = hasConversationMemoryCue(scenario);
  const isCommand = typeof rawMessage === 'string' && rawMessage.trim().startsWith('/');

  let naturalness = 'route-fit';
  if (scenario.type === 'schema') {
    naturalness = 'schema-safety';
  } else if (isCommand || taskType === 'tool') {
    naturalness = 'command-directness';
  } else if (taskCategory === 'follow_up') {
    naturalness = 'follow-up-continuity';
  } else if (taskCategory === 'knowledge_qa') {
    naturalness = 'helpful-answering';
  } else if (taskCategory === 'group_chat') {
    naturalness = 'group-direct-mention';
  } else if (taskCategory === 'private_chat' || taskCategory === 'cold_start') {
    naturalness = 'companion-chat';
  } else if (taskCategory === 'poke') {
    naturalness = 'lightweight-reaction';
  } else if (shouldRespond === false) {
    naturalness = 'quiet-when-not-addressed';
  }

  let memoryUse = 'none';
  if (hasHistory || taskCategory === 'follow_up') {
    memoryUse = 'expected';
  } else if (taskCategory === 'private_chat' || taskCategory === 'group_chat') {
    memoryUse = 'optional';
  }

  let replyLength = 'none';
  if (taskType === 'tool' || taskCategory === 'poke') {
    replyLength = 'short';
  } else if (taskCategory === 'knowledge_qa') {
    replyLength = 'expanded';
  } else if (taskCategory === 'private_chat' || taskCategory === 'cold_start' || taskCategory === 'follow_up') {
    replyLength = 'medium';
  } else if (taskCategory === 'group_chat') {
    replyLength = 'medium';
  }

  return {
    naturalness,
    memoryUse,
    falseTrigger: shouldRespond === false ? 'must_ignore' : 'must_reply',
    replyLength,
    ...explicit,
  };
}

function inferActualReplyLength(task, analysis) {
  if (!analysis?.shouldRespond || task?.type === 'ignore') {
    return 'none';
  }
  if (task?.type === 'tool' || task?.category === 'poke') {
    return 'short';
  }
  if (task?.category === 'knowledge_qa') {
    return 'expanded';
  }
  if (task?.category === 'private_chat' || task?.category === 'cold_start' || task?.category === 'follow_up') {
    return 'medium';
  }
  if (task?.category === 'group_chat') {
    return 'medium';
  }
  return 'short';
}

function scoreReplyLength(expected, actual) {
  if (expected === actual) {
    return 1;
  }
  const order = ['none', 'short', 'medium', 'expanded'];
  const expectedIndex = order.indexOf(expected);
  const actualIndex = order.indexOf(actual);
  if (expectedIndex >= 0 && actualIndex >= 0 && Math.abs(expectedIndex - actualIndex) === 1) {
    return 0.5;
  }
  return 0;
}

function scoreExperience({ scenario, validation, analysis, task, error }) {
  const expected = inferExpectedExperience(scenario);
  const shouldRespond = Boolean(analysis?.shouldRespond);
  const hasHistory = hasConversationMemoryCue(scenario);
  const actualReplyLength = inferActualReplyLength(task, analysis);

  if (scenario.type === 'schema') {
    const validMatched = validation?.ok === scenario.expected?.valid;
    const score = validMatched ? 1 : 0;
    return {
      expected,
      actual: {
        replyLength: 'none',
        memoryUse: 'none',
        falseTrigger: validMatched ? expected.falseTrigger : 'schema-mismatch',
      },
      scores: {
        naturalness: score,
        memoryUse: score,
        falseTrigger: score,
        replyLength: score,
      },
      notes: validMatched ? [] : ['Schema validation behavior did not match expectation.'],
    };
  }

  const notes = [];
  const naturalness = error ? 0 : 1;

  let memoryUse = 1;
  if (expected.memoryUse === 'expected') {
    memoryUse = hasHistory && shouldRespond ? 1 : 0;
    if (memoryUse === 0) {
      notes.push('Expected memory continuity, but the scenario has no conversation memory cue.');
    }
  }

  let falseTrigger = 1;
  if (expected.falseTrigger === 'must_ignore') {
    falseTrigger = !shouldRespond && task?.type === 'ignore' ? 1 : 0;
    if (falseTrigger === 0) {
      notes.push('Scenario expected silence but the bot would respond.');
    }
  } else if (expected.falseTrigger === 'must_reply') {
    falseTrigger = shouldRespond && task?.type !== 'ignore' ? 1 : 0;
    if (falseTrigger === 0) {
      notes.push('Scenario expected a reply but the bot would stay silent.');
    }
  }

  const replyLength = scoreReplyLength(expected.replyLength, actualReplyLength);
  if (replyLength < 1) {
    notes.push(`Expected reply length ${expected.replyLength}, got ${actualReplyLength}.`);
  }

  return {
    expected,
    actual: {
      replyLength: actualReplyLength,
      memoryUse: hasHistory ? 'available' : 'not_available',
      falseTrigger: shouldRespond ? 'reply' : 'ignore',
    },
    scores: {
      naturalness,
      memoryUse,
      falseTrigger,
      replyLength,
    },
    notes,
  };
}

function summarizeExperience(results) {
  const scoreKeys = ['naturalness', 'memoryUse', 'falseTrigger', 'replyLength'];
  const totals = Object.fromEntries(scoreKeys.map((key) => [key, 0]));

  for (const result of results) {
    for (const key of scoreKeys) {
      totals[key] += result.experience.scores[key];
    }
  }

  const count = Math.max(results.length, 1);
  const averages = Object.fromEntries(
    scoreKeys.map((key) => [key, totals[key] / count]),
  );
  const overall = scoreKeys.reduce((sum, key) => sum + averages[key], 0) / scoreKeys.length;

  return {
    count: results.length,
    passed: results.filter((result) => !result.error).length,
    failed: results.filter((result) => result.error).length,
    averages,
    overall,
  };
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function renderExperienceScorecard(results) {
  const summary = summarizeExperience(results);
  const lowScoreRows = results
    .filter((result) => {
      const scores = result.experience.scores;
      const average = (scores.naturalness + scores.memoryUse + scores.falseTrigger + scores.replyLength) / 4;
      return result.error || average < 1;
    })
    .slice(0, 12);

  const lines = [
    '# Yuno Eval Experience Scorecard',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Scenarios: ${summary.count}`,
    `- Correctness: ${summary.passed}/${summary.count} passed`,
    `- Overall experience score: ${formatPercent(summary.overall)}`,
    `- Naturalness: ${formatPercent(summary.averages.naturalness)}`,
    `- Memory use: ${formatPercent(summary.averages.memoryUse)}`,
    `- False-trigger control: ${formatPercent(summary.averages.falseTrigger)}`,
    `- Reply length fit: ${formatPercent(summary.averages.replyLength)}`,
    '',
    '## Scenario Scores',
    '',
    '| Scenario | Status | Naturalness | Memory | False Trigger | Length | Notes |',
    '|---|---|---:|---:|---:|---:|---|',
  ];

  for (const result of results) {
    const scores = result.experience.scores;
    const notes = [result.error, ...result.experience.notes].filter(Boolean).join(' ');
    lines.push([
      result.scenario.id,
      result.error ? 'FAIL' : 'PASS',
      formatPercent(scores.naturalness),
      formatPercent(scores.memoryUse),
      formatPercent(scores.falseTrigger),
      formatPercent(scores.replyLength),
      notes || '-',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('', '## Recommended Follow-up', '');
  if (lowScoreRows.length === 0) {
    lines.push('- No low-score scenario found. Add stricter `expectedExperience` fields to make this scorecard more product-sensitive.');
  } else {
    for (const result of lowScoreRows) {
      lines.push(`- ${result.scenario.id}: ${result.error || result.experience.notes.join(' ')}`);
    }
  }

  lines.push(
    '',
    '## ExpectedExperience Format',
    '',
    'Scenarios may override inferred defaults with:',
    '',
    '```json',
    '{',
    '  "expectedExperience": {',
    '    "naturalness": "companion-chat",',
    '    "memoryUse": "none|optional|expected",',
    '    "falseTrigger": "must_reply|must_ignore",',
    '    "replyLength": "none|short|medium|expanded"',
    '  }',
    '}',
    '```',
    '',
  );

  return lines.join('\n');
}

async function writeExperienceReport(reportPath, results) {
  const absolutePath = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(repoRoot, reportPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, renderExperienceScorecard(results), 'utf8');
  return absolutePath;
}

async function evaluateScenario(scenario) {
  let error = null;
  let validation = null;
  let analysis = null;
  let task = null;

  if (scenario.type === 'schema') {
    validation = validateOnebotMessageEvent(scenario.event);
    error = validation.ok === scenario.expected.valid
      ? null
      : `Expected valid=${scenario.expected.valid}, got ${validation.ok}`;
    const result = { scenario, validation, analysis, task, error };
    return {
      ...result,
      experience: scoreExperience(result),
    };
  }

  validation = validateOnebotMessageEvent(scenario.event);
  if (!validation.ok) {
    error = `Validation failed unexpectedly: ${validation.errors.join('; ')}`;
    const result = { scenario, validation, analysis, task, error };
    return {
      ...result,
      experience: scoreExperience(result),
    };
  }

  const command = parseCommand(validation.value.rawText);
  analysis = command
    ? {
        shouldRespond: true,
        confidence: 1,
        intent: 'query',
        sentiment: 'neutral',
        relevance: 1,
        reason: 'deterministic-command',
        topics: [],
        ruleSignals: ['command'],
        replyStyle: 'calm',
      }
    : await analyzeTrigger(validation.value, {
        relation: scenario.context?.relation || { affection: 30, activeScore: 0, userId: validation.value.userId },
        userState: scenario.context?.userState || { currentEmotion: 'CALM', intensity: 0.3 },
        conversationState: scenario.context?.conversationState || { messages: [], rollingSummary: '' },
        groupState: scenario.context?.groupState || null,
        specialUser: null,
        isAdmin: false,
      }, {
        messageAnalyzer: async () => ({
          intent: 'chat',
          sentiment: 'neutral',
          relevance: 0.4,
          confidence: 0.4,
          shouldReply: false,
          reason: 'eval-stub',
          topics: [],
          replyStyle: 'calm',
        }),
      });

  task = planIncomingTask({
    event: validation.value,
    text: validation.value.rawText,
    analysis,
    conversationState: scenario.context?.conversationState || { messages: [], rollingSummary: '' },
  });

  if (analysis.shouldRespond !== scenario.expected.shouldRespond) {
    error = `Expected shouldRespond=${scenario.expected.shouldRespond}, got ${analysis.shouldRespond}`;
  } else if (task.type !== scenario.expected.taskType) {
    error = `Expected taskType=${scenario.expected.taskType}, got ${task.type}`;
  } else if (scenario.expected.taskCategory && task.category !== scenario.expected.taskCategory) {
    error = `Expected taskCategory=${scenario.expected.taskCategory}, got ${task.category}`;
  }

  const result = { scenario, validation, analysis, task, error };
  return {
    ...result,
    experience: scoreExperience(result),
  };
}

async function main() {
  const args = parseEvalArgs();
  const scenarios = await loadScenarios();
  let failures = 0;
  const results = [];

  for (const scenario of scenarios) {
    const result = await evaluateScenario(scenario);
    results.push(result);
    if (result.error) {
      failures += 1;
      console.error(`[FAIL] ${scenario.id}: ${result.error}`);
    } else {
      console.log(`[PASS] ${scenario.id}`);
    }
  }

  const summary = summarizeExperience(results);
  console.log(
    `Experience scorecard: overall=${formatPercent(summary.overall)}, naturalness=${formatPercent(summary.averages.naturalness)}, memory=${formatPercent(summary.averages.memoryUse)}, falseTrigger=${formatPercent(summary.averages.falseTrigger)}, length=${formatPercent(summary.averages.replyLength)}.`,
  );

  const shouldWriteFailureReport = failures > 0 && !args.reportPath;
  const reportPath = args.reportPath || (shouldWriteFailureReport ? path.join('reports', 'eval-experience.md') : null);
  if (reportPath) {
    const writtenPath = await writeExperienceReport(reportPath, results);
    console.log(`Experience scorecard report written to ${path.relative(repoRoot, writtenPath)}`);
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`All ${scenarios.length} eval scenarios passed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('Eval runner failed:', error.message);
    process.exit(1);
  });
}

export {
  evaluateScenario,
  inferExpectedExperience,
  renderExperienceScorecard,
  scoreExperience,
  summarizeExperience,
};
