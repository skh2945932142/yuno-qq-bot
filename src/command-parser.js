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
  return getToolDefinitions().find((definition) => definition.commandAliases.some((alias) => normalizeHead(alias) === head) && !['watch', 'remind', 'subscribe', 'memory', 'style', 'meme', 'debug'].includes(definition.family));
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

function parseMemoryCommand(tokens) {
  const [head, ...rest] = tokens;
  if (normalizeHead(head) === 'forget' || head === '忘记') {
    const query = rest.join(' ').trim();
    if (!query) return null;
    const definition = findByFamily('memory').find((item) => item.commandType === 'memory_forget');
    return { type: definition.commandType, toolName: definition.name, toolArgs: { query } };
  }

  const definition = findByFamily('memory').find((item) => item.commandType === 'memory');
  return { type: definition.commandType, toolName: definition.name, toolArgs: {} };
}

function parseStyleCommand(tokens) {
  const [, action, key, ...rest] = tokens;
  if ((action === 'set' || action === 'update' || action === '改') && key && rest.length > 0) {
    const definition = findByFamily('style').find((item) => item.commandType === 'style_update');
    return {
      type: definition.commandType,
      toolName: definition.name,
      toolArgs: {
        key: String(key).trim(),
        value: rest.join(' ').trim(),
      },
    };
  }

  const definition = findByFamily('style').find((item) => item.commandType === 'style');
  return { type: definition.commandType, toolName: definition.name, toolArgs: {} };
}

function parseMemeCommand(tokens) {
  const [, action, ...rest] = tokens;
  if (action === 'search' || action === 'find' || action === '搜') {
    const query = rest.join(' ').trim();
    if (!query) return null;
    const definition = findByFamily('meme').find((item) => item.commandType === 'meme_search');
    return { type: definition.commandType, toolName: definition.name, toolArgs: { query } };
  }
  if (action === 'optout' || action === 'off' || action === '关闭收集') {
    const definition = findByFamily('meme').find((item) => item.commandType === 'meme_optout');
    return { type: definition.commandType, toolName: definition.name, toolArgs: { optOut: true } };
  }
  if (action === 'optin' || action === 'on' || action === '开启收集') {
    const definition = findByFamily('meme').find((item) => item.commandType === 'meme_optout');
    return { type: definition.commandType, toolName: definition.name, toolArgs: { optOut: false } };
  }
  return null;
}

function parseDebugCommand(tokens) {
  const [, action] = tokens;
  if (action !== 'why') return null;
  const definition = findByFamily('debug').find((item) => item.commandType === 'debug_why');
  return { type: definition.commandType, toolName: definition.name, toolArgs: {} };
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
  if (head === 'memory' || head === '记忆') {
    return parseMemoryCommand(tokens);
  }
  if (head === 'forget' || head === '忘记') {
    return parseMemoryCommand(tokens);
  }
  if (head === 'style' || head === '风格') {
    return parseStyleCommand(tokens);
  }
  if (head === 'meme' || head === '表情包') {
    return parseMemeCommand(tokens);
  }
  if (head === 'debug') {
    return parseDebugCommand(tokens);
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
      return `我替你看过了。\n现在的好感是 ${relation.affection}/100，活跃度 ${Math.round(relation.activeScore || 0)}，最近情绪偏向 ${userState.currentEmotion}。`;
    case 'emotion':
      return `我替你看了一眼。\n现在的情绪是 ${userState.currentEmotion}，强度 ${(userState.intensity || 0).toFixed(2)}，触发原因是 ${userState.triggerReason}。`;
    case 'group':
      return `群里的气氛我已经替你理了一下。\n现在偏 ${groupState?.mood || 'CALM'}，活跃度 ${Math.round(groupState?.activityLevel || 0)}，最近的话题是 ${formatList(groupState?.recentTopics)}。`;
    case 'profile': {
      const definition = findToolDefinitionByCommandType('profile');
      const summary = userProfile?.profileSummary || relation.memorySummary || definition?.fallbackMessage || '暂无';
      return `我替你把画像翻出来了。\n摘要：${summary}\n偏好：${formatList(userProfile?.favoriteTopics || relation.preferences)}\n常聊话题：${formatList(relation.favoriteTopics)}`;
    }
    default:
      return null;
  }
}
