export function parseCommand(text) {
  const normalized = String(text || '').trim();

  const patterns = [
    ['relation', /^(?:\/)?(?:由乃\s*)?(?:关系|好感)$/i],
    ['emotion', /^(?:\/)?(?:由乃\s*)?(?:情绪|状态)$/i],
    ['group', /^(?:\/)?(?:由乃\s*)?(?:群状态)$/i],
    ['profile', /^(?:\/)?(?:由乃\s*)?(?:画像|记忆)$/i],
  ];

  for (const [type, pattern] of patterns) {
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
      return `当前情绪 ${userState.currentEmotion}\n强度 ${userState.intensity.toFixed(2)}\n触发原因 ${userState.triggerReason}`;
    case 'group':
      return `群状态 ${groupState?.mood || 'CALM'}\n群活跃度 ${Math.round(groupState?.activityLevel || 0)}\n最近主题 ${groupState?.recentTopics?.join('、') || '暂无'}`;
    case 'profile':
      return `画像摘要 ${relation.memorySummary || '暂无'}\n偏好 ${relation.preferences?.join('、') || '暂无'}\n常聊主题 ${relation.favoriteTopics?.join('、') || '暂无'}`;
    default:
      return null;
  }
}
