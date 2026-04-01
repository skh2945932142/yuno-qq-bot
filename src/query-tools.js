import { config } from './config.js';
import {
  buildActivityLeaderboard,
  buildDailyDigest,
  buildGroupActivityReport,
} from './group-ops.js';
import {
  createGroupRule,
  listGroupRules,
  removeGroupRule,
} from './group-automation.js';
import {
  cancelReminderTask,
  cancelSubscriptionTask,
  createReminderTask,
  createSubscriptionTask,
  listReminderTasks,
  listSubscriptionTasks,
} from './automation-tasks.js';
import {
  findToolDefinitionByCommandType,
  getToolDefinitions,
} from './tool-config.js';
import { buildStructuredToolResult } from './yuno-formatter.js';

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function ensureGroupContext(context, toolName) {
  if (context.event?.chatType !== 'group') {
    throw new Error(`${toolName} 只能在群聊里使用`);
  }
}

function ensureAdmin(context, toolName) {
  if (String(context.event?.userId || '') !== String(config.adminQq || '')) {
    throw new Error(`${toolName} 需要管理员权限`);
  }
}

function buildRelationToolResult(context) {
  const relation = context.relation;
  const userState = context.userState;

  return buildStructuredToolResult({
    tool: 'get_relation',
    payload: {
      affection: relation.affection,
      activeScore: numberOrZero(relation.activeScore),
      currentEmotion: userState.currentEmotion,
    },
    summary: `当前好感 ${relation.affection}/100，情绪 ${userState.currentEmotion}。`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: '如果你还想看长期画像，可以继续用 /profile。',
    safetyFlags: [],
  });
}

function buildEmotionToolResult(context) {
  const userState = context.userState;

  return buildStructuredToolResult({
    tool: 'get_emotion',
    payload: {
      emotion: userState.currentEmotion,
      intensity: numberOrZero(userState.intensity),
      triggerReason: userState.triggerReason,
    },
    summary: `当前情绪是 ${userState.currentEmotion}，强度 ${numberOrZero(userState.intensity).toFixed(2)}。`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: '如果你还想看关系变化，可以继续用 /relation。',
    safetyFlags: [],
  });
}

function buildGroupToolResult(context) {
  const groupState = context.groupState;

  return buildStructuredToolResult({
    tool: 'get_group_state',
    payload: {
      mood: groupState?.mood || 'CALM',
      activityLevel: numberOrZero(groupState?.activityLevel),
      recentTopics: groupState?.recentTopics || [],
    },
    summary: `群气氛偏 ${groupState?.mood || 'CALM'}，活跃度 ${Math.round(numberOrZero(groupState?.activityLevel))}。`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: '想看更完整的群报告，可以试试 /groupreport 24。',
    safetyFlags: [],
  });
}

function buildProfileToolResult(context) {
  const relation = context.relation;
  const userProfile = context.userProfile;
  const definition = findToolDefinitionByCommandType('profile');

  return buildStructuredToolResult({
    tool: 'get_profile',
    payload: {
      memorySummary: userProfile?.profileSummary || relation.memorySummary || '',
      preferredName: userProfile?.preferredName || '',
      tonePreference: userProfile?.tonePreference || '',
      preferences: relation.preferences || [],
      favoriteTopics: userProfile?.favoriteTopics || relation.favoriteTopics || [],
      dislikes: userProfile?.dislikes || [],
    },
    summary: userProfile?.profileSummary || relation.memorySummary || definition?.fallbackMessage || '稳定画像还不够多，我还在慢慢记。',
    visibility: 'default',
    priority: 'normal',
    followUpHint: '如果你还想看现在的关系读数，可以继续用 /relation。',
    safetyFlags: [],
  });
}

function buildHelpToolResult() {
  const commands = getToolDefinitions().map((definition) => `/${definition.commandAliases[0]}`);
  return buildStructuredToolResult({
    tool: 'get_help',
    payload: {
      commands,
    },
    summary: `现在可直接使用的命令有：${commands.join('、')}`,
    visibility: 'default',
    priority: 'low',
    followUpHint: '常用的是 /groupreport、/leaderboard、/watch、/remind、/subscribe。',
    safetyFlags: [],
  });
}

async function buildGroupReportToolResult(args, context) {
  ensureGroupContext(context, 'get_group_report');
  const report = await buildGroupActivityReport(context.event.chatId, {
    windowHours: args.windowHours || 24,
  });

  return buildStructuredToolResult({
    tool: 'group_report',
    payload: report,
    summary: `最近 ${report.windowHours} 小时里一共 ${report.totalMessages} 条消息，活跃了 ${report.activeUsers} 个人。`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: '想看谁最活跃，可以继续用 /leaderboard。',
    safetyFlags: [],
  });
}

async function buildLeaderboardToolResult(args, context) {
  ensureGroupContext(context, 'get_activity_leaderboard');
  const leaderboard = await buildActivityLeaderboard(context.event.chatId, {
    windowHours: args.windowHours || 24,
    limit: args.limit || 5,
  });

  return buildStructuredToolResult({
    tool: 'activity_leaderboard',
    payload: leaderboard,
    summary: `最近 ${leaderboard.windowHours} 小时的活跃榜已经排好了，共 ${leaderboard.leaders.length} 位。`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: '想看整体群活跃情况，可以继续用 /groupreport。',
    safetyFlags: [],
  });
}

async function addKeywordWatch(args, context) {
  ensureGroupContext(context, 'add_keyword_watch');
  ensureAdmin(context, 'add_keyword_watch');
  const rule = await createGroupRule({
    groupId: context.event.chatId,
    ruleType: 'keyword_watch',
    pattern: args.keyword,
    label: `watch:${args.keyword}`,
    createdBy: context.event.userId,
  });

  return buildStructuredToolResult({
    tool: 'keyword_watch_added',
    payload: rule,
    summary: `这个群里我已经开始盯着关键词“${rule.pattern}”。`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: '想看现在挂着哪些规则，可以用 /watch list。',
    safetyFlags: [],
  });
}

async function removeKeywordWatch(args, context) {
  ensureGroupContext(context, 'remove_keyword_watch');
  ensureAdmin(context, 'remove_keyword_watch');
  const rules = await listGroupRules(context.event.chatId, { ruleType: 'keyword_watch', enabled: true });
  const match = rules.find((rule) => String(rule.pattern || '').toLowerCase() === String(args.keyword || '').toLowerCase());
  if (!match) {
    return buildStructuredToolResult({
      tool: 'keyword_watch_removed',
      payload: { keyword: args.keyword, removed: false },
      summary: `我没找到正在盯着“${args.keyword}”的规则。`,
      visibility: 'group',
      priority: 'low',
      followUpHint: '你可以先用 /watch list 看看当前规则。',
      safetyFlags: [],
    });
  }

  await removeGroupRule(match.ruleId);
  return buildStructuredToolResult({
    tool: 'keyword_watch_removed',
    payload: { keyword: args.keyword, removed: true },
    summary: `我已经不再盯着关键词“${args.keyword}”了。`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: '如果还要加新的，可以用 /watch add <关键词>。',
    safetyFlags: [],
  });
}

async function listKeywordWatch(context) {
  ensureGroupContext(context, 'list_keyword_watch');
  ensureAdmin(context, 'list_keyword_watch');
  const rules = await listGroupRules(context.event.chatId, { ruleType: 'keyword_watch', enabled: true });
  return buildStructuredToolResult({
    tool: 'keyword_watch_list',
    payload: {
      groupId: context.event.chatId,
      rules,
    },
    summary: rules.length > 0
      ? `现在一共盯着 ${rules.length} 个关键词：${rules.map((rule) => rule.pattern).join('、')}`
      : '现在还没有生效中的关键词盯梢。',
    visibility: 'group',
    priority: 'low',
    followUpHint: '如果要新增，直接用 /watch add <关键词>。',
    safetyFlags: [],
  });
}

async function addReminder(args, context) {
  const task = await createReminderTask({
    platform: context.event.platform,
    chatType: context.event.chatType,
    chatId: context.event.chatId,
    groupId: context.event.chatType === 'group' ? context.event.chatId : '',
    userId: context.event.userId,
    delayMinutes: args.delayMinutes,
    text: args.text,
  });

  return buildStructuredToolResult({
    tool: 'reminder_created',
    payload: task,
    summary: `提醒已经记下了，${args.delayMinutes} 分钟后我会叫你。`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: '想看还挂着哪些提醒，可以用 /remind list。',
    safetyFlags: [],
  });
}

async function listReminders(context) {
  const tasks = await listReminderTasks({
    chatId: context.event.chatId,
    userId: context.event.userId,
  });

  return buildStructuredToolResult({
    tool: 'reminder_list',
    payload: { tasks },
    summary: tasks.length > 0
      ? `你现在还挂着 ${tasks.length} 个提醒。`
      : '你现在没有挂着的提醒。',
    visibility: 'default',
    priority: 'low',
    followUpHint: '如果要新建提醒，可以用 /remind add <分钟> <内容>。',
    safetyFlags: [],
  });
}

async function cancelReminder(args, context) {
  const task = await cancelReminderTask(args.taskId);
  return buildStructuredToolResult({
    tool: 'reminder_cancelled',
    payload: { taskId: args.taskId, cancelled: Boolean(task) },
    summary: task ? `提醒 ${args.taskId} 已经取消。` : `我没找到编号为 ${args.taskId} 的提醒。`,
    visibility: 'default',
    priority: 'low',
    followUpHint: '',
    safetyFlags: [],
  });
}

async function addSubscription(args, context) {
  const task = await createSubscriptionTask({
    platform: context.event.platform,
    chatType: context.event.chatType,
    chatId: context.event.chatId,
    groupId: context.event.chatType === 'group' ? context.event.chatId : '',
    userId: context.event.userId,
    sourceType: args.sourceType,
    target: args.target,
    intervalMinutes: args.intervalMinutes,
    summary: `${args.sourceType}:${args.target}`,
  });

  return buildStructuredToolResult({
    tool: 'subscription_created',
    payload: task,
    summary: `订阅已经挂上了：${args.sourceType} / ${args.target}，每 ${args.intervalMinutes} 分钟检查一次。`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: '想看当前订阅，可以用 /subscribe list。',
    safetyFlags: [],
  });
}

async function listSubscriptions(context) {
  const tasks = await listSubscriptionTasks({
    chatId: context.event.chatId,
    userId: context.event.userId,
  });

  return buildStructuredToolResult({
    tool: 'subscription_list',
    payload: { tasks },
    summary: tasks.length > 0
      ? `你现在挂着 ${tasks.length} 条订阅。`
      : '你现在没有生效中的订阅。',
    visibility: 'default',
    priority: 'low',
    followUpHint: '如果要新增订阅，可以用 /subscribe add <类型> <目标> <分钟>。',
    safetyFlags: [],
  });
}

async function cancelSubscription(args) {
  const task = await cancelSubscriptionTask(args.taskId);
  return buildStructuredToolResult({
    tool: 'subscription_cancelled',
    payload: { taskId: args.taskId, cancelled: Boolean(task) },
    summary: task ? `订阅 ${args.taskId} 已经取消。` : `我没找到编号为 ${args.taskId} 的订阅。`,
    visibility: 'default',
    priority: 'low',
    followUpHint: '',
    safetyFlags: [],
  });
}

const TOOL_EXECUTORS = {
  get_relation: async (_args, context) => buildRelationToolResult(context),
  get_emotion: async (_args, context) => buildEmotionToolResult(context),
  get_group_state: async (_args, context) => buildGroupToolResult(context),
  get_group_report: buildGroupReportToolResult,
  get_activity_leaderboard: buildLeaderboardToolResult,
  get_profile: async (_args, context) => buildProfileToolResult(context),
  add_keyword_watch: addKeywordWatch,
  remove_keyword_watch: removeKeywordWatch,
  list_keyword_watch: async (_args, context) => listKeywordWatch(context),
  add_reminder: addReminder,
  list_reminders: async (_args, context) => listReminders(context),
  cancel_reminder: cancelReminder,
  add_subscription: addSubscription,
  list_subscriptions: async (_args, context) => listSubscriptions(context),
  cancel_subscription: cancelSubscription,
  get_help: async () => buildHelpToolResult(),
};

export function registerQueryTools(registry) {
  for (const definition of getToolDefinitions()) {
    registry.register({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema || { type: 'object', properties: {}, required: [] },
      permissions: definition.permissions,
      allowIn: definition.allowIn,
      metadata: definition,
      execute: async (args, context) => TOOL_EXECUTORS[definition.name](args || {}, context),
    });
  }

  return registry;
}

export function mapCommandToTool(command) {
  if (!command?.toolName) {
    return null;
  }

  const definition = getToolDefinitions().find((item) => item.name === command.toolName);
  if (!definition) {
    return null;
  }

  return {
    name: definition.name,
    args: command.toolArgs || {},
    metadata: definition,
  };
}
