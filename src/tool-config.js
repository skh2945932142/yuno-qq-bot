function buildCommandPattern(aliases) {
  const escaped = aliases.map((alias) => String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^(?:\\/)?(?:由乃\\s*)?(?:${escaped.join('|')})(?:\\s+.*)?$`, 'i');
}

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'get_relation',
    commandType: 'relation',
    family: 'relation',
    commandAliases: ['relation', '关系', '好感'],
    description: 'Read the current relation snapshot for the user.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['关系', '好感', '亲密度'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not read the relation snapshot right now.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_emotion',
    commandType: 'emotion',
    family: 'emotion',
    commandAliases: ['emotion', '情绪', '状态'],
    description: 'Read the current emotion state for the user.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['情绪', '状态'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not read the emotion state right now.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_group_state',
    commandType: 'group',
    family: 'group',
    commandAliases: ['group', 'groupstate', '群状态'],
    description: 'Read the current group state summary.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['群状态', '群里情况'],
    allowIn: ['group'],
    rateLimitMs: 0,
    fallbackMessage: 'There is no group state summary yet.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_group_report',
    commandType: 'group_report',
    family: 'groupreport',
    commandAliases: ['groupreport', 'report', '群日报', '群报告'],
    description: 'Read a recent activity report for the current group.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['群日报', '群报告'],
    allowIn: ['group'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not build the group report yet.',
    inputSchema: {
      type: 'object',
      properties: {
        windowHours: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_activity_leaderboard',
    commandType: 'activity_leaderboard',
    family: 'leaderboard',
    commandAliases: ['leaderboard', 'top', '活跃榜'],
    description: 'Read the recent activity leaderboard for the current group.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['活跃榜', '排行榜'],
    allowIn: ['group'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not build the leaderboard yet.',
    inputSchema: {
      type: 'object',
      properties: {
        windowHours: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_profile',
    commandType: 'profile',
    family: 'profile',
    commandAliases: ['profile', '画像', '记忆'],
    description: 'Read the current long-term profile summary for the user.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['画像', '记忆', '画像摘要'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not read the profile summary right now.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_keyword_watch',
    commandType: 'keyword_watch_add',
    family: 'watch',
    commandAliases: ['watch'],
    description: 'Add a keyword watch rule for the current group.',
    permissions: ['admin'],
    triggerKeywords: ['watch'],
    allowIn: ['group'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not add that keyword watch.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'remove_keyword_watch',
    commandType: 'keyword_watch_remove',
    family: 'watch',
    commandAliases: ['watch'],
    description: 'Remove a keyword watch rule for the current group.',
    permissions: ['admin'],
    triggerKeywords: ['watch'],
    allowIn: ['group'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not remove that keyword watch.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'list_keyword_watch',
    commandType: 'keyword_watch_list',
    family: 'watch',
    commandAliases: ['watch'],
    description: 'List keyword watch rules for the current group.',
    permissions: ['admin'],
    triggerKeywords: ['watch'],
    allowIn: ['group'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not list keyword watches.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_reminder',
    commandType: 'reminder_add',
    family: 'remind',
    commandAliases: ['remind', 'reminder'],
    description: 'Create a reminder task.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['提醒'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not create that reminder.',
    inputSchema: {
      type: 'object',
      properties: {
        delayMinutes: { type: 'number' },
        text: { type: 'string' },
      },
      required: ['delayMinutes', 'text'],
    },
  },
  {
    name: 'list_reminders',
    commandType: 'reminder_list',
    family: 'remind',
    commandAliases: ['remind', 'reminder'],
    description: 'List current reminders.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['提醒'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not list reminders.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'cancel_reminder',
    commandType: 'reminder_cancel',
    family: 'remind',
    commandAliases: ['remind', 'reminder'],
    description: 'Cancel a reminder by task id.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['提醒'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not cancel that reminder.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'add_subscription',
    commandType: 'subscription_add',
    family: 'subscribe',
    commandAliases: ['subscribe', 'sub'],
    description: 'Create a subscription task.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['订阅'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not create that subscription.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceType: { type: 'string' },
        target: { type: 'string' },
        intervalMinutes: { type: 'number' },
      },
      required: ['sourceType', 'target', 'intervalMinutes'],
    },
  },
  {
    name: 'list_subscriptions',
    commandType: 'subscription_list',
    family: 'subscribe',
    commandAliases: ['subscribe', 'sub'],
    description: 'List current subscriptions.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['订阅'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not list subscriptions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'cancel_subscription',
    commandType: 'subscription_cancel',
    family: 'subscribe',
    commandAliases: ['subscribe', 'sub'],
    description: 'Cancel a subscription by task id.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['订阅'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not cancel that subscription.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'get_help',
    commandType: 'help',
    family: 'help',
    commandAliases: ['help', 'command', 'commands', '命令', '帮助'],
    description: 'Read the available command list.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['help', 'command', '命令', '帮助'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: 'I could not list commands right now.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
]);

function mergeDefinitions(base, overrides = []) {
  if (!Array.isArray(overrides) || overrides.length === 0) {
    return base;
  }

  const overrideMap = new Map(overrides.map((item) => [item.name, item]));
  return base.map((definition) => ({
    ...definition,
    ...(overrideMap.get(definition.name) || {}),
  }));
}

export function getToolDefinitions() {
  let overrides = [];
  if (process.env.TOOL_CONFIG_JSON) {
    try {
      overrides = JSON.parse(process.env.TOOL_CONFIG_JSON);
    } catch {
      overrides = [];
    }
  }

  return mergeDefinitions(TOOL_DEFINITIONS, overrides).map((definition) => ({
    ...definition,
    commandPattern: buildCommandPattern(definition.commandAliases),
  }));
}

export function findToolDefinitionByCommandType(commandType) {
  return getToolDefinitions().find((item) => item.commandType === commandType) || null;
}

export function findToolDefinitionByName(name) {
  return getToolDefinitions().find((item) => item.name === name) || null;
}
