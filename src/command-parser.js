import { findToolDefinitionByCommandType, getToolDefinitions } from './tool-config.js';

function formatList(items, fallback = '暂无') {
  return items?.length ? items.join(' / ') : fallback;
}

export function parseCommand(text) {
  const normalized = String(text || '').trim();

  for (const definition of getToolDefinitions()) {
    if (definition.commandPattern.test(normalized)) {
      return {
        type: definition.commandType,
        toolName: definition.name,
      };
    }
  }

  return null;
}

export function buildCommandResponse(command, { relation, userState, groupState, userProfile }) {
  switch (command.type) {
    case 'relation':
      return `关系值 ${relation.affection}/100\n活跃度 ${Math.round(relation.activeScore || 0)}\n最近情绪 ${userState.currentEmotion}`;
    case 'emotion':
      return `当前情绪 ${userState.currentEmotion}\n强度 ${(userState.intensity || 0).toFixed(2)}\n触发原因 ${userState.triggerReason}`;
    case 'group':
      return `群状态 ${groupState?.mood || 'CALM'}\n群活跃度 ${Math.round(groupState?.activityLevel || 0)}\n最近主题 ${formatList(groupState?.recentTopics)}`;
    case 'profile': {
      const definition = findToolDefinitionByCommandType('profile');
      const summary = userProfile?.profileSummary || relation.memorySummary || definition?.fallbackMessage || '暂无';
      return `画像摘要 ${summary}\n偏好 ${formatList(userProfile?.favoriteTopics || relation.preferences)}\n常聊主题 ${formatList(relation.favoriteTopics)}`;
    }
    default:
      return null;
  }
}
