import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTrigger } from '../src/services/analysis.js';
import { validateGroupMessageEvent } from '../src/schemas/group-message-event.js';
import { planIncomingTask } from '../src/agents/task-router.js';
import { parseCommand } from '../src/services/commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scenariosPath = path.join(__dirname, 'scenarios.json');

async function loadScenarios() {
  const raw = await fs.readFile(scenariosPath, 'utf8');
  return JSON.parse(raw);
}

async function evaluateScenario(scenario) {
  if (scenario.type === 'schema') {
    const validation = validateGroupMessageEvent(scenario.event);
    return validation.ok === scenario.expected.valid
      ? null
      : `Expected valid=${scenario.expected.valid}, got ${validation.ok}`;
  }

  const validation = validateGroupMessageEvent(scenario.event);
  if (!validation.ok) {
    return `Validation failed unexpectedly: ${validation.errors.join('; ')}`;
  }

  const command = parseCommand(validation.value.raw_message);
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
    : await analyzeTrigger(validation.value, scenario.context, {
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
    text: validation.value.raw_message,
    analysis,
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
