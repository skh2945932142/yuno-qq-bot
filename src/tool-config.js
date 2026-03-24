function commandPattern(patterns) {
  return new RegExp(`^(?:\\/)?(?:由乃\\s*)?(?:${patterns.join('|')})$`, 'i');
}

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'get_relation',
    commandType: 'relation',
    commandAliases: ['关系', '好感', 'relation'],
    description: 'Read the current long-term relation snapshot for the user.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['关系', '好感', '亲密度'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '暂时拿不到关系快照。',
  },
  {
    name: 'get_emotion',
    commandType: 'emotion',
    commandAliases: ['情绪', '状态', 'emotion'],
    description: 'Read the current short-term emotion state for the user.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['情绪', '状态'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '暂时拿不到情绪状态。',
  },
  {
    name: 'get_group_state',
    commandType: 'group',
    commandAliases: ['群状态', 'group'],
    description: 'Read the current group state summary.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['群状态', '群里情况'],
    allowIn: ['group'],
    rateLimitMs: 0,
    fallbackMessage: '当前没有群状态可读。',
  },
  {
    name: 'get_profile',
    commandType: 'profile',
    commandAliases: ['画像', '记忆', 'profile'],
    description: 'Read the current long-term profile summary for the user.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['画像', '记忆', '画像摘要'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '暂时拿不到画像摘要。',
  },
  {
    name: 'get_help',
    commandType: 'help',
    commandAliases: ['help', 'command', 'commands', '命令', '帮助'],
    description: 'Read the available command list.',
    permissions: ['member', 'admin'],
    triggerKeywords: ['help', 'command', '命令', '帮助'],
    allowIn: ['group', 'private'],
    rateLimitMs: 0,
    fallbackMessage: '暂时拿不到命令列表。',
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
    commandPattern: commandPattern(definition.commandAliases),
  }));
}

export function findToolDefinitionByCommandType(commandType) {
  return getToolDefinitions().find((item) => item.commandType === commandType) || null;
}

export function findToolDefinitionByName(name) {
  return getToolDefinitions().find((item) => item.name === name) || null;
}
