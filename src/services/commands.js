const COMMAND_PATTERNS = [
  ['relation', /^(?:\/)?(?:由乃\s*)?(?:关系|好感|relation)$/i],
  ['emotion', /^(?:\/)?(?:由乃\s*)?(?:情绪|状态|emotion)$/i],
  ['group', /^(?:\/)?(?:由乃\s*)?(?:群状态|group)$/i],
  ['profile', /^(?:\/)?(?:由乃\s*)?(?:画像|记忆|profile)$/i],
];

function formatList(items) {
  return items?.length ? items.join(' / ') : '暂无';
}

export function parseCommand(text) {
  const normalized = String(text || '').trim();

  for (const [type, pattern] of COMMAND_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type };
    }
  }

  return null;
}

export function buildCommandResponse(command, { relation, userState, groupState }) {
  switch (command.type) {
    case 'relation':
      return `关系值 ${relation.affection}/100\n活跃度 ${Math.round(relation.activeScore || 0)}\n最近情绪 ${userState.currentEmotion}`;
    case 'emotion':
      return `当前情绪 ${userState.currentEmotion}\n强度 ${(userState.intensity || 0).toFixed(2)}\n触发原因 ${userState.triggerReason}`;
    case 'group':
      return `群状态 ${groupState?.mood || 'CALM'}\n群活跃度 ${Math.round(groupState?.activityLevel || 0)}\n最近主题 ${formatList(groupState?.recentTopics)}`;
    case 'profile':
      return `画像摘要 ${relation.memorySummary || '暂无'}\n偏好 ${formatList(relation.preferences)}\n常聊主题 ${formatList(relation.favoriteTopics)}`;
    default:
      return null;
  }
}
