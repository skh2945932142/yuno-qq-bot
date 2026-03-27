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
  findToolDefinitionByName,
  getToolDefinitions,
} from './tool-config.js';
import { buildStructuredToolResult } from './yuno-formatter.js';

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function formatList(items, fallback = 'none') {
  return items?.length ? items.join(' / ') : fallback;
}

function ensureGroupContext(context, toolName) {
  if (context.event?.chatType !== 'group') {
    throw new Error(`${toolName} is only available in group chat`);
  }
}

function ensureAdmin(context, toolName) {
  if (String(context.event?.userId || '') !== String(config.adminQq || '')) {
    throw new Error(`${toolName} requires admin permission`);
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
    summary: `Affection ${relation.affection}/100, emotion ${userState.currentEmotion}.`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: 'Ask for /profile if you want the long-term summary too.',
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
    summary: `Emotion ${userState.currentEmotion} with intensity ${numberOrZero(userState.intensity).toFixed(2)}.`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: 'Use /relation if you want the relationship context behind it.',
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
    summary: `Group mood ${groupState?.mood || 'CALM'}, activity ${Math.round(numberOrZero(groupState?.activityLevel))}.`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: 'Try /groupreport 24 for a wider report.',
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
    summary: userProfile?.profileSummary || relation.memorySummary || definition?.fallbackMessage || 'No stable profile data yet.',
    visibility: 'default',
    priority: 'normal',
    followUpHint: 'Use /relation if you want the current bond reading too.',
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
    summary: `Available commands: ${commands.join(', ')}`,
    visibility: 'default',
    priority: 'low',
    followUpHint: 'Use /groupreport, /leaderboard, /watch, /remind, or /subscribe.',
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
    summary: `Last ${report.windowHours}h: ${report.totalMessages} messages from ${report.activeUsers} active users.`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: 'Use /leaderboard to see the most active members.',
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
    summary: `Top ${leaderboard.leaders.length} active members in the last ${leaderboard.windowHours}h.`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: 'Use /groupreport for the wider activity summary.',
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
    summary: `Watching keyword "${rule.pattern}" in this group.`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: 'Use /watch list to inspect current watch rules.',
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
      summary: `No keyword watch matched "${args.keyword}".`,
      visibility: 'group',
      priority: 'low',
      followUpHint: 'Use /watch list to see active rules.',
      safetyFlags: [],
    });
  }

  await removeGroupRule(match.ruleId);
  return buildStructuredToolResult({
    tool: 'keyword_watch_removed',
    payload: { keyword: args.keyword, removed: true },
    summary: `Stopped watching keyword "${args.keyword}".`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: 'Use /watch add <keyword> to add another one.',
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
      ? `Watching ${rules.length} keyword(s): ${rules.map((rule) => rule.pattern).join(', ')}`
      : 'No keyword watches are active right now.',
    visibility: 'group',
    priority: 'low',
    followUpHint: 'Use /watch add <keyword> to create a new watch rule.',
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
    summary: `Reminder set for ${args.delayMinutes} minute(s) from now.`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: 'Use /remind list if you want to inspect pending reminders.',
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
      ? `You have ${tasks.length} reminder(s) pending.`
      : 'You do not have any pending reminders.',
    visibility: 'default',
    priority: 'low',
    followUpHint: 'Use /remind add <minutes> <text> to create one.',
    safetyFlags: [],
  });
}

async function cancelReminder(args, context) {
  const task = await cancelReminderTask(args.taskId);
  return buildStructuredToolResult({
    tool: 'reminder_cancelled',
    payload: { taskId: args.taskId, cancelled: Boolean(task) },
    summary: task ? `Reminder ${args.taskId} has been cancelled.` : `No reminder matched ${args.taskId}.`,
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
    summary: `Subscription created for ${args.sourceType} ${args.target} every ${args.intervalMinutes} minute(s).`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: 'Use /subscribe list to inspect current subscriptions.',
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
      ? `You have ${tasks.length} subscription(s) active.`
      : 'You do not have any active subscriptions.',
    visibility: 'default',
    priority: 'low',
    followUpHint: 'Use /subscribe add <type> <target> <minutes> to create one.',
    safetyFlags: [],
  });
}

async function cancelSubscription(args) {
  const task = await cancelSubscriptionTask(args.taskId);
  return buildStructuredToolResult({
    tool: 'subscription_cancelled',
    payload: { taskId: args.taskId, cancelled: Boolean(task) },
    summary: task ? `Subscription ${args.taskId} has been cancelled.` : `No subscription matched ${args.taskId}.`,
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

