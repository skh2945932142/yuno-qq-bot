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
    fallbackMessage: '关系快照我暂时还没读出来。',
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
    fallbackMessage: '当前情绪我暂时还没读出来。',
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
    fallbackMessage: '群状态摘要还没有攒够。',
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
    fallbackMessage: '群报告我暂时还没整理出来。',
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
    fallbackMessage: '活跃榜我暂时还没排出来。',
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
    fallbackMessage: '画像摘要我暂时还没读出来。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_memory',
    commandType: 'memory',
    family: 'memory',
    commandAliases: ['memory', '记忆'],
    description: 'Read the current user memory summary and recent important memories.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['记忆'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '我现在还没攒到足够稳定的记忆。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'forget_user_memory',
    commandType: 'memory_forget',
    family: 'memory',
    commandAliases: ['forget', '忘记'],
    description: 'Delete user memory entries matching a keyword.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['忘记'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '这条记忆我暂时没能删掉。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_style',
    commandType: 'style',
    family: 'style',
    commandAliases: ['style', '风格'],
    description: 'Read the current reply style preference for this user.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['风格'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '我还没读到稳定的回复风格偏好。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_style',
    commandType: 'style_update',
    family: 'style',
    commandAliases: ['style', '风格'],
    description: 'Update a reply style preference for this user.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['风格'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '这条风格偏好我暂时没能改上。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'search_memes',
    commandType: 'meme_search',
    family: 'meme',
    commandAliases: ['meme', '表情包'],
    description: 'Search stored meme assets by keyword and semantic tags.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['表情包'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '我暂时没找到合适的表情包。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'set_meme_opt_out',
    commandType: 'meme_optout',
    family: 'meme',
    commandAliases: ['meme', '表情包'],
    description: 'Opt the current user in or out of meme auto collection.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['表情包'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '这个表情包偏好我暂时没能改上。',
    inputSchema: {
      type: 'object',
      properties: {
        optOut: { type: 'boolean' },
      },
      required: ['optOut'],
    },
  },
  {
    name: 'debug_why',
    commandType: 'debug_why',
    family: 'debug',
    commandAliases: ['debug'],
    description: 'Show why the current message was routed or replied to.',
    permissions: ['admin'],
    triggerKeywords: ['debug'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '这轮调试信息我暂时没拿到。',
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
    fallbackMessage: '这个关键词盯梢我暂时没加上。',
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
    fallbackMessage: '这个关键词盯梢我暂时没撤掉。',
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
    fallbackMessage: '关键词盯梢列表我暂时没列出来。',
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
    fallbackMessage: '这个提醒我暂时还没记上。',
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
    fallbackMessage: '提醒列表我暂时还没翻出来。',
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
    fallbackMessage: '这个提醒我暂时还没撤掉。',
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
    fallbackMessage: '这条订阅我暂时还没挂上。',
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
    fallbackMessage: '订阅列表我暂时还没翻出来。',
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
    fallbackMessage: '这条订阅我暂时还没停掉。',
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
    fallbackMessage: '命令列表我暂时还没整理出来。',
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
