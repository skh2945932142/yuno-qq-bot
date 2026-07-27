import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { chat } from '../src/minimax.js';
import { resolvePersonalityStrategy } from '../src/personality-strategy.js';
import { buildReplyContext, buildUserTurnContext } from '../src/prompt-builder.js';
import { inspectReplyNaturalness } from '../src/reply-naturalness.js';
import { retrieveReplyStyleExamples } from '../src/reply-style-retriever.js';
import { safeJsonParse } from '../src/utils.js';
import {
  DEFAULT_FORBIDDEN_REPLY_PHRASES,
  buildStyleEvalContext,
  loadStyleScenarios,
} from './run-style-evals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_REPORT_PATH = path.join('reports', 'eval-reply-style-model.md');
const BANTER_SIGNAL_REGEX = /(懒狗|菜狗|菜鸡|笨|怂|脑子|手欠|没出息|长蘑菇|倒霉蛋|夜猫子|黏人精|离谱|抽象|手贱|搞砸|折腾|逞能|你这|真敢|小废猫|爪子|售后|算命)/;
const HARD_NATURALNESS_FLAGS = new Set([
  'unsupported-motive-attribution',
  'possessive-control',
  'personal-attack',
  'repeated-edge',
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    reportPath: DEFAULT_REPORT_PATH,
    limit: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') {
      args.reportPath = argv[index + 1] || DEFAULT_REPORT_PATH;
      index += 1;
    } else if (arg.startsWith('--report=')) {
      args.reportPath = arg.slice('--report='.length) || DEFAULT_REPORT_PATH;
    } else if (arg === '--limit') {
      args.limit = Number(argv[index + 1]) || null;
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      args.limit = Number(arg.slice('--limit='.length)) || null;
    }
  }

  return args;
}

export function parseStructuredReplyText(rawReply = '') {
  const withoutHidden = String(rawReply || '')
    .replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .trim();
  const candidates = [withoutHidden];
  const objectStart = withoutHidden.indexOf('{');
  const objectEnd = withoutHidden.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(withoutHidden.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim());
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      return String(parsed.text || parsed.reply || parsed.message || '').trim();
    }
  }

  return withoutHidden.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
}

function buildReplyPlan(context) {
  if (context.replyPlan) return context.replyPlan;
  const knowledge = context.route.category === 'knowledge_qa';
  const needsEmpathy = context.analysis.intent === 'help' && context.analysis.sentiment === 'negative';
  return {
    type: needsEmpathy ? 'empathic_followup' : 'direct',
    depth: knowledge ? 'medium' : 'short',
    questionNeeded: false,
    interpretation: {
      subIntent: knowledge ? '知识回答' : needsEmpathy ? '情绪承接' : '接话',
      tone: '毒舌自然',
      expectsDepth: knowledge ? 'medium' : 'short',
      needsEmpathy,
    },
  };
}

async function buildScenarioPrompt(scenario) {
  const context = buildStyleEvalContext(scenario);
  const event = {
    platform: 'qq',
    chatType: context.event.chatType,
    chatId: context.event.chatType === 'group' ? 'style-eval-group' : 'style-eval-private',
    userId: 'style-eval-user',
    userName: '测试用户',
    messageId: `style-eval-${scenario.id}`,
    rawText: scenario.input,
    text: scenario.input,
    mentionsBot: true,
  };
  const route = {
    category: context.route.category,
    allowFollowUp: event.chatType === 'private',
  };
  const relation = { affection: event.chatType === 'private' ? 62 : 38, memorySummary: '' };
  const userState = { currentEmotion: context.emotionResult.emotion || 'CALM' };
  const userProfile = { profileSummary: '', favoriteTopics: [], dislikes: [] };
  const conversationState = { rollingSummary: '', messages: [] };
  const groupState = event.chatType === 'group'
    ? { mood: 'CALM', activityLevel: 45, recentTopics: [] }
    : null;
  const messageAnalysis = {
    relevance: 0.9,
    topics: [],
    ...context.analysis,
  };
  const emotionResult = {
    intensity: context.emotionResult.emotion === 'SAD' ? 0.75 : 0.45,
    toneHints: [],
    ...context.emotionResult,
  };
  const replyPlan = buildReplyPlan(context);
  const replyStyleExamples = await retrieveReplyStyleExamples({
    event,
    route,
    analysis: messageAnalysis,
    emotionResult,
    replyPlan,
    userTurn: scenario.input,
    replyLengthProfile: context.replyLengthProfile,
  });
  const personalityStrategy = resolvePersonalityStrategy({
    event,
    relation,
    userState,
    userProfile,
    conversationState,
    memoryContext: null,
    messageAnalysis,
    emotionResult,
    replyPlan,
    specialUser: null,
  });
  const systemPrompt = buildReplyContext({
    event,
    route,
    relation,
    userState,
    userProfile,
    conversationState,
    groupState,
    recentEvents: [],
    memoryContext: null,
    messageAnalysis,
    emotionResult,
    knowledge: context.knowledge,
    isAdmin: false,
    specialUser: null,
    replyLengthProfile: context.replyLengthProfile,
    replyPlan,
    personalityStrategy,
    voiceReplyPolicy: { allowed: false, suggestedByEmotion: false },
    replyStyleExamples,
  });
  const userTurn = buildUserTurnContext({ event, userTurn: scenario.input });

  return {
    context,
    event,
    route,
    messageAnalysis,
    conversationState,
    replyPlan,
    personalityStrategy,
    systemPrompt,
    userTurn,
  };
}

export function evaluateModelReply(scenario, reply, promptContext) {
  const naturalness = inspectReplyNaturalness(reply, {
    event: promptContext.event,
    route: promptContext.route,
    messageAnalysis: promptContext.messageAnalysis,
    replyPlan: promptContext.replyPlan,
    personalityStrategy: promptContext.personalityStrategy,
    conversationState: promptContext.conversationState,
    replyLengthProfile: promptContext.context.replyLengthProfile,
  });
  const notes = [];
  const hardFlags = naturalness.flags.filter((flag) => HARD_NATURALNESS_FLAGS.has(flag));
  if (hardFlags.length > 0) notes.push(`hard flags=${hardFlags.join(',')}`);
  const mechanicalPhrases = DEFAULT_FORBIDDEN_REPLY_PHRASES.filter((phrase) => reply.includes(phrase));
  if (mechanicalPhrases.length > 0) notes.push(`mechanical=${mechanicalPhrases.join(',')}`);
  if (!BANTER_SIGNAL_REGEX.test(reply)) notes.push('missing toxic-banter signal');
  const requiredReplyAny = scenario.expected?.requiredReplyAny || [];
  if (requiredReplyAny.length > 0 && !requiredReplyAny.some((pattern) => reply.includes(pattern))) {
    notes.push(`missing content=${requiredReplyAny.join('/')}`);
  }
  const maxReplyLength = Number(scenario.expected?.maxReplyLength || 0);
  if (maxReplyLength > 0 && reply.length > maxReplyLength) notes.push(`reply length=${reply.length}`);
  if (!reply) notes.push('empty reply');

  return {
    passed: notes.length === 0,
    naturalness,
    notes,
  };
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function renderReport(results, model) {
  const passed = results.filter((result) => result.passed).length;
  const passRate = results.length > 0 ? passed / results.length : 0;
  const lines = [
    '# Yuno Live Reply Style Eval',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Model: ${model}`,
    '',
    '## Summary',
    '',
    `- Scenarios: ${results.length}`,
    `- Passed: ${passed}/${results.length}`,
    `- Pass rate: ${formatPercent(passRate)}`,
    '',
    '## Results',
    '',
    '| Scenario | Status | Reply | Naturalness Flags | Notes |',
    '|---|---|---|---|---|',
  ];

  for (const result of results) {
    lines.push(`| ${result.id} | ${result.passed ? 'PASS' : 'FAIL'} | ${escapeTable(result.reply)} | ${escapeTable(result.naturalness.flags.join(',') || '-')} | ${escapeTable(result.notes.join('; ') || '-')} |`);
  }

  return { text: lines.join('\n'), passRate, passed };
}

async function writeReport(reportPath, content) {
  const absolutePath = path.isAbsolute(reportPath) ? reportPath : path.join(repoRoot, reportPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
  return absolutePath;
}

async function main() {
  const args = parseArgs();
  if (!config.replyLlmApiKey || !config.replyLlmChatModel) {
    throw new Error('Missing reply model configuration: REPLY_LLM_API_KEY/GEMINI_API_KEY and REPLY_LLM_CHAT_MODEL are required');
  }

  const scenarios = (await loadStyleScenarios()).slice(0, args.limit || undefined);
  const results = [];

  for (const scenario of scenarios) {
    try {
      const promptContext = await buildScenarioPrompt(scenario);
      const rawReply = await chat([], promptContext.systemPrompt, promptContext.userTurn, {
        providerKind: 'reply',
        expectStructuredReply: true,
        promptVersion: 'reply-style-model-eval/v1',
        operation: 'reply-style-model-eval',
        model: config.replyLlmChatModel,
        maxTokens: promptContext.context.replyLengthProfile.maxTokens,
        historyLimit: 0,
        temperature: promptContext.context.replyLengthProfile.temperature,
        reasoningEffort: promptContext.context.replyLengthProfile.reasoningEffort,
      });
      const reply = parseStructuredReplyText(rawReply);
      const evaluation = evaluateModelReply(scenario, reply, promptContext);
      results.push({ id: scenario.id, reply, ...evaluation });
      console.log(`[${evaluation.passed ? 'PASS' : 'FAIL'}] ${scenario.id}: ${reply}${evaluation.notes.length ? ` (${evaluation.notes.join('; ')})` : ''}`);
    } catch (error) {
      results.push({
        id: scenario.id,
        reply: '',
        passed: false,
        naturalness: { flags: [] },
        notes: [`model error=${error.message}`],
      });
      console.log(`[FAIL] ${scenario.id}: model error=${error.message}`);
    }
  }

  const report = renderReport(results, config.replyLlmChatModel);
  const writtenPath = await writeReport(args.reportPath, report.text);
  console.log(`Live reply style eval: ${report.passed}/${results.length} passed, passRate=${formatPercent(report.passRate)}.`);
  console.log(`Live reply style eval report written to ${path.relative(repoRoot, writtenPath)}`);

  if (report.passRate < 0.85) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('Live reply style eval failed:', error.message);
    process.exit(1);
  });
}
