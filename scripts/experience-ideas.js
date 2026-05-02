import {
  collectRepoFiles,
  countMatches,
  isCliEntrypoint,
  parseWriteArg,
  readJsonFile,
  readTextFile,
  writeReport,
} from './automation-utils.js';

function buildIdea(title, why, action, effort = 'M', impact = 'M') {
  return { title, why, action, effort, impact };
}

export function collectExperienceSignals() {
  const files = collectRepoFiles();
  const scenarios = readJsonFile('evals/scenarios.json', []);
  const packageJson = readJsonFile('package.json', {});
  const promptBuilder = readTextFile('src/prompt-builder.js');
  const commandConfig = readTextFile('src/tool-config.js');
  const workflow = readTextFile('src/message-workflow.js');
  const readme = readTextFile('README.md');
  const evalRunner = readTextFile('evals/run-evals.js');

  return {
    sourceFiles: files.filter((file) => file.startsWith('src/')).length,
    testFiles: files.filter((file) => /^phase1-.*\.test\.js$/.test(file) || file.startsWith('test/')).length,
    evalScenarios: Array.isArray(scenarios) ? scenarios.length : 0,
    commands: [...commandConfig.matchAll(/commandAliases:\s*\[([^\]]+)\]/g)].length,
    promptHasMemory: /重要事件|表情风格|长期/.test(promptBuilder),
    promptHasNoReasoningRule: /think|思考过程|推理/.test(promptBuilder),
    workflowHasReplyBudget: /replyHardTimeoutMs|replyTimeBudgetMs/.test(workflow),
    hasEvalScorecard: Boolean(packageJson.scripts?.['eval:report'] && /renderExperienceScorecard/.test(evalRunner)),
    todoCount: countMatches(files.filter((file) => /\.(js|md|yml|json)$/.test(file)), /\b(?:TODO|FIXME|HACK)\b/g),
    hasSecurityAutomation: Boolean(packageJson.scripts?.['security:audit'] && packageJson.scripts?.['security:secrets']),
    hasUsageDocs: /\/memory|\/style|\/meme/.test(readme),
  };
}

export function generateExperienceIdeas(signals = collectExperienceSignals()) {
  const ideas = [];

  if (signals.hasEvalScorecard) {
    ideas.push(buildIdea(
      'Expand eval expectedExperience coverage',
      `The eval scorecard now covers ${signals.evalScenarios} scenarios; the next gain is stricter product expectations instead of more routing-only checks.`,
      'Add explicit expectedExperience overrides to high-risk comfort, memory, meme, and tool-failure scenarios, then decide the score threshold that should fail CI.',
      'S',
      'H'
    ));
  } else {
    ideas.push(buildIdea(
    '把 eval 结果升级成“体验评分卡”',
    `当前已有 ${signals.evalScenarios} 个结构化场景，但通过/失败还不能直接反映自然度、是否接住语气、是否啰嗦。`,
    '为每个 eval 场景补充 expectedExperience 字段，输出自然度、记忆使用、误触发、回复长度四项评分，失败时生成 markdown 报告。',
    'M',
    'H'
    ));
  }

  ideas.push(buildIdea(
    '增加群聊冷场/热闹状态的自动建议',
    '陪伴型 bot 的核心体验不是一直回复，而是判断什么时候插一句最自然。',
    '基于 group-ops 的最近消息量、重复度和关键词，生成“冷场接话建议”和“刷屏降噪建议”，先只报告不自动发言。',
    'M',
    'H'
  ));

  ideas.push(buildIdea(
    '给记忆命令加“可解释预览”',
    '用户会担心 bot 记错或记太多，透明度会直接影响长期使用信任。',
    '在私聊 /memory 输出里增加“来源类型、置信度、过期时间”的简短预览，并把低置信记忆标出来等待用户确认。',
    'S',
    'H'
  ));

  ideas.push(buildIdea(
    '把表情包能力做成 opt-in 体验实验',
    '表情包自动发送如果过于积极会破坏群聊气氛，但完全不用又浪费已有语义记忆。',
    '增加一个灰度实验配置：只在白名单群 + 高匹配场景 + 用户未 opt-out 时建议发送，并在报告里统计“建议但未发送”的机会。',
    'M',
    'M'
  ));

  ideas.push(buildIdea(
    '自动发现“重复兜底文案”',
    '机械兜底会让 bot 显得像服务台，不像群友。',
    '扫描 formatter、fallback、tool fallback 文案，统计重复句式；当同一句出现多处时在报告中建议合并或改写。',
    'S',
    'M'
  ));

  if (signals.todoCount > 0) {
    ideas.push(buildIdea(
      '把 TODO/FIXME 自动转成可排期清单',
      `当前仓库还有 ${signals.todoCount} 个 TODO/FIXME/HACK 标记。`,
      '在开发健康报告中列出文件、关键词和建议优先级，避免隐藏债务长期漂着。',
      'S',
      'M'
    ));
  }

  if (!signals.promptHasNoReasoningRule) {
    ideas.push(buildIdea(
      '补强 hidden reasoning 防线',
      'prompt 缺少显式禁止思考过程的规则时，部分模型容易把推理文本泄露到群聊。',
      '在 prompt 快照和回复清洗测试中同时覆盖 <think>、分析、推理、步骤说明四类泄露。',
      'S',
      'H'
    ));
  }

  return ideas;
}

export function renderExperienceIdeasReport(signals = collectExperienceSignals(), ideas = generateExperienceIdeas(signals)) {
  const rows = ideas.map((idea, index) => (
    `| ${index + 1} | ${idea.title} | ${idea.impact} | ${idea.effort} | ${idea.action} |`
  )).join('\n');

  return [
    '# Yuno Experience Radar',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Signals',
    '',
    `- Source files: ${signals.sourceFiles}`,
    `- Test files: ${signals.testFiles}`,
    `- Eval scenarios: ${signals.evalScenarios}`,
    `- Command families/signatures: ${signals.commands}`,
    `- TODO/FIXME/HACK count: ${signals.todoCount}`,
    `- Memory-aware prompt: ${signals.promptHasMemory ? 'yes' : 'no'}`,
    `- Hidden reasoning guard: ${signals.promptHasNoReasoningRule ? 'yes' : 'no'}`,
    `- Reply budget guard: ${signals.workflowHasReplyBudget ? 'yes' : 'no'}`,
    `- Eval experience scorecard: ${signals.hasEvalScorecard ? 'yes' : 'no'}`,
    `- Security automation: ${signals.hasSecurityAutomation ? 'yes' : 'no'}`,
    '',
    '## Suggested Ideas',
    '',
    '| # | Idea | Impact | Effort | Concrete next step |',
    '|---|---|---|---|---|',
    rows,
    '',
    '## Recommended Next Pick',
    '',
    ideas[0]
      ? `Start with **${ideas[0].title}** because it has the best current impact-to-effort ratio from the scanned repo signals.`
      : 'No ideas generated.',
    '',
  ].join('\n');
}

if (isCliEntrypoint(import.meta.url)) {
  const report = renderExperienceIdeasReport();
  const outputPath = parseWriteArg();
  if (outputPath) {
    const absolutePath = writeReport(outputPath, report);
    console.log(`Experience ideas report written to ${absolutePath}`);
  } else {
    console.log(report);
  }
}
