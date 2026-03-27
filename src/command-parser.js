import { findToolDefinitionByCommandType, getToolDefinitions } from './tool-config.js';

function formatList(items, fallback = '暂无') {
  return items?.length ? items.join(' / ') : fallback;
}

function stripCommandPrefix(text) {
  return String(text || '').trim().replace(/^(?:\/)?(?:由乃\s*)?/i, '').trim();
}

function tokenize(text) {
  return stripCommandPrefix(text).split(/\s+/).filter(Boolean);
}

function normalizeHead(token) {
  return String(token || '').trim().toLowerCase();
}

function findByFamily(family) {
  return getToolDefinitions().filter((item) => item.family === family);
}

function findSimpleDefinition(head) {
  return getToolDefinitions().find((definition) => definition.commandAliases.some((alias) => normalizeHead(alias) === head) && !['watch', 'remind', 'subscribe'].includes(definition.family));
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseWatchCommand(tokens) {
  const [, action, ...rest] = tokens;
  const keyword = rest.join(' ').trim();
  if (action === 'add' && keyword) {
    const definition = findByFamily('watch').find((item) => item.commandType === 'keyword_watch_add');
    return { type: definition.commandType, toolName: definition.name, toolArgs: { keyword } };
  }
  if ((action === 'remove' || action === 'rm' || action === 'delete') && keyword) {
    const definition = findByFamily('watch').find((item) => item.commandType === 'keyword_watch_remove');
    return { type: definition.commandType, toolName: definition.name, toolArgs: { keyword } };
  }
  if (action === 'list' || !action) {
    const definition = findByFamily('watch').find((item) => item.commandType === 'keyword_watch_list');
    return { type: definition.commandType, toolName: definition.name, toolArgs: {} };
  }
  return null;
}

function parseReminderCommand(tokens) {
  const [, action, ...rest] = tokens;
  if (action === 'add' && rest.length >= 2) {
    const delayMinutes = parsePositiveNumber(rest[0], 0);
    const text = rest.slice(1).join(' ').trim();
    if (delayMinutes > 0 && text) {
      const definition = findByFamily('remind').find((item) => item.commandType === 'reminder_add');
      return { type: definition.commandType, toolName: definition.name, toolArgs: { delayMinutes, text } };
    }
  }
  if (action === 'list' || !action) {
    const definition = findByFamily('remind').find((item) => item.commandType === 'reminder_list');
    return { type: definition.commandType, toolName: definition.name, toolArgs: {} };
  }
  if ((action === 'cancel' || action === 'rm' || action === 'delete') && rest[0]) {
    const definition = findByFamily('remind').find((item) => item.commandType === 'reminder_cancel');
    return { type: definition.commandType, toolName: definition.name, toolArgs: { taskId: String(rest[0]).trim() } };
  }
  return null;
}

function parseSubscriptionCommand(tokens) {
  const [, action, ...rest] = tokens;
  if (action === 'add' && rest.length >= 3) {
    const [sourceType, target, intervalRaw] = rest;
    const intervalMinutes = parsePositiveNumber(intervalRaw, 0);
    if (sourceType && target && intervalMinutes > 0) {
      const definition = findByFamily('subscribe').find((item) => item.commandType === 'subscription_add');
      return {
        type: definition.commandType,
        toolName: definition.name,
        toolArgs: {
          sourceType: String(sourceType).trim(),
          target: String(target).trim(),
          intervalMinutes,
        },
      };
    }
  }
  if (action === 'list' || !action) {
    const definition = findByFamily('subscribe').find((item) => item.commandType === 'subscription_list');
    return { type: definition.commandType, toolName: definition.name, toolArgs: {} };
  }
  if ((action === 'cancel' || action === 'rm' || action === 'delete') && rest[0]) {
    const definition = findByFamily('subscribe').find((item) => item.commandType === 'subscription_cancel');
    return { type: definition.commandType, toolName: definition.name, toolArgs: { taskId: String(rest[0]).trim() } };
  }
  return null;
}

export function parseCommand(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return null;
  }

  const head = normalizeHead(tokens[0]);
  if (head === 'watch') {
    return parseWatchCommand(tokens);
  }
  if (head === 'remind' || head === 'reminder') {
    return parseReminderCommand(tokens);
  }
  if (head === 'subscribe' || head === 'sub') {
    return parseSubscriptionCommand(tokens);
  }

  const definition = findSimpleDefinition(head);
  if (!definition) {
    return null;
  }

  const toolArgs = {};
  if (definition.commandType === 'group_report') {
    toolArgs.windowHours = parsePositiveNumber(tokens[1], 24);
  }
  if (definition.commandType === 'activity_leaderboard') {
    toolArgs.windowHours = parsePositiveNumber(tokens[1], 24);
    toolArgs.limit = parsePositiveNumber(tokens[2], 5);
  }

  return {
    type: definition.commandType,
    toolName: definition.name,
    toolArgs,
  };
}

export function buildCommandResponse(command, { relation, userState, groupState, userProfile }) {
  switch (command.type) {
    case 'relation':
      return `关系值 ${relation.affection}/100\n活跃度 ${Math.round(relation.activeScore || 0)}\n最近情绪 ${userState.currentEmotion}`;
    case 'emotion':
      return `当前情绪 ${userState.currentEmotion}\n强度 ${(userState.intensity || 0).toFixed(2)}\n触发原因 ${userState.triggerReason}`;
    case 'group':
      return `群状态 ${groupState?.mood || 'CALM'}\n群活跃度 ${Math.round(groupState?.activityLevel || 0)}\n最近话题 ${formatList(groupState?.recentTopics)}`;
    case 'profile': {
      const definition = findToolDefinitionByCommandType('profile');
      const summary = userProfile?.profileSummary || relation.memorySummary || definition?.fallbackMessage || '暂无';
      return `画像摘要 ${summary}\n偏好 ${formatList(userProfile?.favoriteTopics || relation.preferences)}\n常聊话题 ${formatList(relation.favoriteTopics)}`;
    }
    default:
      return null;
  }
}
