function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function buildRelationToolResult(context) {
  const relation = context.relation;
  const userState = context.userState;

  return {
    type: 'relation',
    text: `关系值 ${relation.affection}/100\n活跃度 ${Math.round(numberOrZero(relation.activeScore))}\n最近情绪 ${userState.currentEmotion}`,
    data: {
      affection: relation.affection,
      activeScore: numberOrZero(relation.activeScore),
      currentEmotion: userState.currentEmotion,
    },
  };
}

function buildEmotionToolResult(context) {
  const userState = context.userState;

  return {
    type: 'emotion',
    text: `当前情绪 ${userState.currentEmotion}\n强度 ${numberOrZero(userState.intensity).toFixed(2)}\n触发原因 ${userState.triggerReason}`,
    data: {
      emotion: userState.currentEmotion,
      intensity: numberOrZero(userState.intensity),
      triggerReason: userState.triggerReason,
    },
  };
}

function buildGroupToolResult(context) {
  const groupState = context.groupState;
  const topics = groupState?.recentTopics?.join(' / ') || 'none';

  return {
    type: 'group',
    text: `群状态 ${groupState?.mood || 'CALM'}\n群活跃度 ${Math.round(numberOrZero(groupState?.activityLevel))}\n最近主题 ${topics}`,
    data: {
      mood: groupState?.mood || 'CALM',
      activityLevel: numberOrZero(groupState?.activityLevel),
      recentTopics: groupState?.recentTopics || [],
    },
  };
}

function buildProfileToolResult(context) {
  const relation = context.relation;
  const preferences = relation.preferences?.join(' / ') || 'none';
  const favoriteTopics = relation.favoriteTopics?.join(' / ') || 'none';

  return {
    type: 'profile',
    text: `画像摘要 ${relation.memorySummary || 'none'}\n偏好 ${preferences}\n常聊主题 ${favoriteTopics}`,
    data: {
      memorySummary: relation.memorySummary || '',
      preferences: relation.preferences || [],
      favoriteTopics: relation.favoriteTopics || [],
    },
  };
}

const QUERY_TOOLS = [
  {
    name: 'get_relation',
    description: 'Read the current long-term relation snapshot for the user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async (_args, context) => buildRelationToolResult(context),
  },
  {
    name: 'get_emotion',
    description: 'Read the current short-term emotion state for the user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async (_args, context) => buildEmotionToolResult(context),
  },
  {
    name: 'get_group_state',
    description: 'Read the current group state summary.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async (_args, context) => buildGroupToolResult(context),
  },
  {
    name: 'get_profile',
    description: 'Read the current long-term profile summary for the user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async (_args, context) => buildProfileToolResult(context),
  },
];

const COMMAND_TO_TOOL_NAME = {
  relation: 'get_relation',
  emotion: 'get_emotion',
  group: 'get_group_state',
  profile: 'get_profile',
};

export function registerQueryTools(registry) {
  for (const tool of QUERY_TOOLS) {
    registry.register(tool);
  }
  return registry;
}

export function mapCommandToTool(command) {
  if (!command?.type) {
    return null;
  }

  const toolName = COMMAND_TO_TOOL_NAME[command.type];
  return toolName
    ? {
        name: toolName,
        args: {},
      }
    : null;
}
