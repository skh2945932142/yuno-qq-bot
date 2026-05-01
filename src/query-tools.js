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
import { UserMemoryEvent, UserProfileMemory } from './models.js';
import { findMemeAssets } from './meme-repository.js';
import { buildUserProfileKey } from './chat/session.js';
import { buildProfileSummary } from './profile-memory.js';
import { listActiveUserMemoryEvents } from './user-memory-events.js';

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

function compactText(value, limit = 80) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function buildMemoryToolResult(context) {
  const profile = context.userProfile || {};
  let memories = Array.isArray(context.memoryContext?.eventMemories)
    ? context.memoryContext.eventMemories
    : [];
  if (memories.length === 0) {
    memories = await listActiveUserMemoryEvents({
      userId: context.event.userId,
      limit: 5,
    }).catch(() => []);
  }
  const summaries = memories
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${compactText(item.summary, 72)}`)
    .filter(Boolean);

  return buildStructuredToolResult({
    tool: 'get_memory',
    payload: {
      profileSummary: profile.profileSummary || '',
      speakingStyleSummary: profile.speakingStyleSummary || '',
      frequentPhrases: profile.frequentPhrases || [],
      responsePreference: profile.responsePreference || '',
      eventMemories: memories.map((item) => ({
        memoryId: item.memoryId,
        eventType: item.eventType,
        summary: item.summary,
      })),
    },
    summary: [
      profile.profileSummary ? `画像：${profile.profileSummary}` : '稳定画像还不多。',
      summaries.length ? `近期重要记忆：${summaries.join('；')}` : '近期重要事件还不多。',
    ].join(' '),
    visibility: 'default',
    priority: 'normal',
    followUpHint: '想删掉某条记忆，可以用 /forget <关键词>。',
    safetyFlags: [],
  });
}

async function forgetUserMemory(args, context) {
  const query = compactText(args.query, 48);
  if (!query) {
    return buildStructuredToolResult({
      tool: 'memory_forget',
      payload: { deletedCount: 0, query },
      summary: '你要我忘掉哪一条，给我一个关键词就行。',
      visibility: 'default',
      priority: 'low',
      followUpHint: '例如 /forget 面试。',
      safetyFlags: [],
    });
  }

  const pattern = new RegExp(escapeRegex(query), 'i');
  const result = await UserMemoryEvent.deleteMany({
    userId: String(context.event.userId || ''),
    $or: [
      { summary: pattern },
      { rawExcerpt: pattern },
      { tags: pattern },
    ],
  });

  return buildStructuredToolResult({
    tool: 'memory_forget',
    payload: {
      query,
      deletedCount: result.deletedCount || 0,
    },
    summary: result.deletedCount > 0
      ? `我已经删掉 ${result.deletedCount} 条和“${query}”有关的记忆。`
      : `我没找到和“${query}”匹配的长期记忆。`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: '你也可以用 /memory 看看我现在还记着什么。',
    safetyFlags: [],
  });
}

function buildStyleToolResult(context) {
  const profile = context.userProfile || {};
  const summary = [
    profile.preferredName ? `称呼：${profile.preferredName}` : '',
    profile.tonePreference ? `语气：${profile.tonePreference}` : '',
    profile.responsePreference ? `长短：${profile.responsePreference}` : '',
    profile.emojiStyle ? `表情：${profile.emojiStyle}` : '',
    profile.humorStyle ? `幽默：${profile.humorStyle}` : '',
    profile.speakingStyleSummary ? `整体：${profile.speakingStyleSummary}` : '',
  ].filter(Boolean);

  return buildStructuredToolResult({
    tool: 'get_style',
    payload: {
      preferredName: profile.preferredName || '',
      tonePreference: profile.tonePreference || '',
      responsePreference: profile.responsePreference || '',
      emojiStyle: profile.emojiStyle || '',
      humorStyle: profile.humorStyle || '',
      speakingStyleSummary: profile.speakingStyleSummary || '',
      memeOptOut: Boolean(profile.memeOptOut),
    },
    summary: summary.length
      ? `我现在按这些偏好和你说话：${summary.join('；')}。`
      : '我还没读到很稳定的说话风格偏好。',
    visibility: 'default',
    priority: 'normal',
    followUpHint: '可以用 /style set tone 温柔 或 /style set length detailed 来改。',
    safetyFlags: [],
  });
}

function normalizeStylePatch(key, value) {
  const normalizedKey = String(key || '').trim().toLowerCase();
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return null;

  if (['name', '称呼', 'preferredname'].includes(normalizedKey)) {
    return { preferredName: normalizedValue.slice(0, 24) };
  }
  if (['tone', '语气'].includes(normalizedKey)) {
    return { tonePreference: normalizedValue.slice(0, 32) };
  }
  if (['length', 'reply', '长短', '回复'].includes(normalizedKey)) {
    return { responsePreference: normalizedValue.slice(0, 32) };
  }
  if (['emoji', '表情'].includes(normalizedKey)) {
    return { emojiStyle: normalizedValue.slice(0, 32) };
  }
  if (['humor', '梗', '幽默'].includes(normalizedKey)) {
    return { humorStyle: normalizedValue.slice(0, 32) };
  }
  return { speakingStyleSummary: normalizedValue.slice(0, 96) };
}

async function updateStylePreference(args, context) {
  const patch = normalizeStylePatch(args.key, args.value);
  if (!patch) {
    return buildStructuredToolResult({
      tool: 'style_updated',
      payload: { updated: false },
      summary: '这条风格偏好我没看懂。你可以用 /style set tone 温柔 这样改。',
      visibility: 'default',
      priority: 'low',
      followUpHint: '',
      safetyFlags: [],
    });
  }

  const profileKey = context.userProfile?.profileKey || buildUserProfileKey({
    platform: context.event.platform || 'qq',
    userId: context.event.userId,
  });
  const nextProfile = {
    ...(context.userProfile || {}),
    ...patch,
  };
  const profileSummary = buildProfileSummary(nextProfile);
  const updated = await UserProfileMemory.findOneAndUpdate(
    { profileKey },
    {
      $set: {
        ...patch,
        profileSummary,
        styleLastUpdated: new Date(),
        lastUpdated: new Date(),
      },
      $setOnInsert: {
        platform: context.event.platform || 'qq',
        userId: String(context.event.userId || ''),
        profileKey,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return buildStructuredToolResult({
    tool: 'style_updated',
    payload: {
      updated: true,
      patch,
      profileSummary: updated?.profileSummary || profileSummary,
    },
    summary: `这条偏好我记下了：${Object.entries(patch).map(([key, value]) => `${key}=${value}`).join('，')}。`,
    visibility: 'default',
    priority: 'normal',
    followUpHint: '之后我会按这个方向调整回复。',
    safetyFlags: [],
  });
}

async function searchMemes(args, context) {
  const query = String(args.query || '').trim().toLowerCase();
  const assets = await findMemeAssets({
    chatId: context.event.chatId,
    limit: 30,
    safetyStatus: 'safe',
  });
  const matches = assets.filter((asset) => {
    const haystack = [
      asset.caption,
      asset.usageContext,
      asset.quoteText,
      ...(asset.tags || []),
      ...(asset.semanticTags || []),
    ].join(' ').toLowerCase();
    return !query || haystack.includes(query);
  }).slice(0, 5);

  return buildStructuredToolResult({
    tool: 'meme_search',
    payload: {
      query,
      count: matches.length,
      assets: matches.map((asset) => ({
        assetId: asset.assetId,
        caption: asset.caption || '',
        semanticTags: asset.semanticTags || [],
        usageContext: asset.usageContext || '',
        imageUrl: asset.imageUrl || '',
        storagePath: asset.storagePath || '',
      })),
    },
    summary: matches.length > 0
      ? `我找到了 ${matches.length} 张可能合适的表情包。`
      : `我没找到和“${args.query}”很贴的表情包。`,
    visibility: 'group',
    priority: 'normal',
    followUpHint: matches.length > 0 ? '要直接发图，可以继续指定更明确的关键词。' : '',
    safetyFlags: [],
  });
}

async function setMemeOptOut(args, context) {
  const optOut = Boolean(args.optOut);
  const profileKey = context.userProfile?.profileKey || buildUserProfileKey({
    platform: context.event.platform || 'qq',
    userId: context.event.userId,
  });
  await UserProfileMemory.findOneAndUpdate(
    { profileKey },
    {
      $set: {
        memeOptOut: optOut,
        lastUpdated: new Date(),
      },
      $setOnInsert: {
        platform: context.event.platform || 'qq',
        userId: String(context.event.userId || ''),
        profileKey,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return buildStructuredToolResult({
    tool: 'meme_optout',
    payload: { optOut },
    summary: optOut
      ? '我记下了，之后不会自动收集你发的表情包素材。'
      : '我记下了，之后可以继续自动收集你发的表情包素材。',
    visibility: 'default',
    priority: 'normal',
    followUpHint: '',
    safetyFlags: [],
  });
}

function buildDebugWhyToolResult(context) {
  ensureAdmin(context, 'debug_why');
  const analysis = context.analysis || {};
  return buildStructuredToolResult({
    tool: 'debug_why',
    payload: {
      reason: analysis.reason || '',
      shouldRespond: Boolean(analysis.shouldRespond),
      confidence: analysis.confidence ?? null,
      relevance: analysis.relevance ?? null,
      ruleSignals: analysis.ruleSignals || [],
      decisionExplanation: analysis.decisionExplanation || null,
    },
    summary: `这轮判断：${analysis.shouldRespond ? '会回复' : '不回复'}，原因=${analysis.reason || 'unknown'}，信号=${(analysis.ruleSignals || []).join('/') || '无'}。`,
    visibility: 'admin',
    priority: 'low',
    followUpHint: '',
    safetyFlags: [],
  });
}

function buildHelpToolResult() {
  const commands = [...new Set(getToolDefinitions().map((definition) => `/${definition.commandAliases[0]}`))];
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
  get_memory: async (_args, context) => buildMemoryToolResult(context),
  forget_user_memory: forgetUserMemory,
  get_style: async (_args, context) => buildStyleToolResult(context),
  update_style: updateStylePreference,
  search_memes: searchMemes,
  set_meme_opt_out: setMemeOptOut,
  debug_why: async (_args, context) => buildDebugWhyToolResult(context),
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
