function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function formatList(items, fallback = 'none') {
  return items?.length ? items.join(' / ') : fallback;
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

  return {
    type: 'group',
    text: `群状态 ${groupState?.mood || 'CALM'}\n群活跃度 ${Math.round(numberOrZero(groupState?.activityLevel))}\n最近主题 ${formatList(groupState?.recentTopics)}`,
    data: {
      mood: groupState?.mood || 'CALM',
      activityLevel: numberOrZero(groupState?.activityLevel),
      recentTopics: groupState?.recentTopics || [],
    },
  };
}

function buildProfileToolResult(context) {
  const relation = context.relation;
  const userProfile = context.userProfile;

  return {
    type: 'profile',
    text: `画像摘要 ${userProfile?.profileSummary || relation.memorySummary || 'none'}\n偏好 ${formatList(userProfile?.favoriteTopics || relation.preferences)}\n不喜欢 ${formatList(userProfile?.dislikes, '暂无')}\n常聊主题 ${formatList(relation.favoriteTopics)}`,
    data: {
      memorySummary: userProfile?.profileSummary || relation.memorySummary || '',
      preferredName: userProfile?.preferredName || '',
      tonePreference: userProfile?.tonePreference || '',
      preferences: relation.preferences || [],
      favoriteTopics: userProfile?.favoriteTopics || relation.favoriteTopics || [],
      dislikes: userProfile?.dislikes || [],
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

export function registerQueryTools(registry) {
  for (const tool of QUERY_TOOLS) {
    registry.register(tool);
  }
  return registry;
}
