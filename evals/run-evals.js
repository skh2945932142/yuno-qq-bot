import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTrigger } from '../src/message-analysis.js';
import { validateOnebotMessageEvent } from '../src/adapters/onebot-event.js';
import { planIncomingTask } from '../src/task-router.js';
import { parseCommand } from '../src/command-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scenariosPath = path.join(__dirname, 'scenarios.json');

async function loadScenarios() {
  const raw = await fs.readFile(scenariosPath, 'utf8');
  return JSON.parse(raw);
}

async function evaluateScenario(scenario) {
  if (scenario.type === 'schema') {
    const validation = validateOnebotMessageEvent(scenario.event);
    return validation.ok === scenario.expected.valid
      ? null
      : `Expected valid=${scenario.expected.valid}, got ${validation.ok}`;
  }

  const validation = validateOnebotMessageEvent(scenario.event);
  if (!validation.ok) {
    return `Validation failed unexpectedly: ${validation.errors.join('; ')}`;
  }

  const command = parseCommand(validation.value.rawText);
  const analysis = command
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

  const task = planIncomingTask({
    event: validation.value,
    text: validation.value.rawText,
    analysis,
    conversationState: scenario.context?.conversationState || { messages: [], rollingSummary: '' },
  });

  if (analysis.shouldRespond !== scenario.expected.shouldRespond) {
    return `Expected shouldRespond=${scenario.expected.shouldRespond}, got ${analysis.shouldRespond}`;
  }

  if (task.type !== scenario.expected.taskType) {
    return `Expected taskType=${scenario.expected.taskType}, got ${task.type}`;
  }

  return null;
}

async function main() {
  const scenarios = await loadScenarios();
  let failures = 0;

  for (const scenario of scenarios) {
    const error = await evaluateScenario(scenario);
    if (error) {
      failures += 1;
      console.error(`[FAIL] ${scenario.id}: ${error}`);
    } else {
      console.log(`[PASS] ${scenario.id}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`All ${scenarios.length} eval scenarios passed.`);
}

main().catch((error) => {
  console.error('Eval runner failed:', error.message);
  process.exit(1);
});
