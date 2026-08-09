const GAME_MINI_COMMAND_NAME_LIST = [
  '猜数字',
  '猜王者英雄',
  '成语接龙',
  '算24点',
  '海龟汤',
  '性格推理',
  '排行榜',
  '清零',
];

const GAME_MINI_COMMAND_NAME_SET = new Set(GAME_MINI_COMMAND_NAME_LIST);
const GAME_MINI_ACTIVE_GAME_COMMAND_NAME_SET = new Set(['猜数字', '算24点']);
const GAME_MINI_END_MESSAGE_MARKERS = [
  '比赛结束！',
  '比赛已停止',
  '太久没人玩啦，比赛自动结束～',
];

export const GAME_MINI_COMMAND_NAMES = Object.freeze([...GAME_MINI_COMMAND_NAME_LIST]);
export const GAME_MINI_INACTIVITY_SECONDS = 60;
export const GAME_MINI_INACTIVITY_MS = GAME_MINI_INACTIVITY_SECONDS * 1000;

function getGameMiniCommandName(session = {}) {
  return String(session?.argv?.command?.name || '').trim();
}

function getGameMiniCommandAction(session = {}) {
  const argvAction = session?.argv?.args?.[0];
  if (argvAction !== undefined && argvAction !== null) {
    return String(argvAction).trim();
  }

  const commandName = getGameMiniCommandName(session);
  const content = String(session?.content || '').trim().replace(/^\//, '');
  if (!commandName || !content.startsWith(commandName)) return '';
  return content.slice(commandName.length).trim().split(/\s+/, 1)[0] || '';
}

function isGroupGameSession(session = {}) {
  if (session?.isDirect || session?.subtype === 'private') return false;
  return Boolean(session?.channelId || session?.guildId);
}

function getGameMiniSessionKey(session = {}) {
  if (!isGroupGameSession(session)) return '';
  const platform = String(session?.platform || 'default');
  const channelId = String(session?.channelId || session?.guildId || '');
  return channelId ? `${platform}:${channelId}` : '';
}

function normalizeInactivityMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : GAME_MINI_INACTIVITY_MS;
}

export function createGameMiniConfig() {
  return {
    enableNumberGuess: true,
    enableWzHero: false,
    enableChengyuJielong: false,
    enableCalc24: true,
    enableTurtleSoup: false,
    enableCharacterGame: false,
    privateGame: {
      enableNumberGuess: false,
      enableWzHero: false,
      enableChengyuJielong: false,
      enableCalc24: false,
      enableTurtleSoup: false,
      enableCharacterGame: false,
    },
    rank: {
      enableCommand: false,
    },
    guessNumber: {
      autoStopInactiveTime: GAME_MINI_INACTIVITY_SECONDS,
      botParticipateInGroup: false,
      showRank: true,
    },
    calc24: {
      autoStopInactiveTime: GAME_MINI_INACTIVITY_SECONDS,
      showRank: true,
    },
  };
}

export function createGameMiniSessionController(options = {}) {
  const inactivityMs = normalizeInactivityMs(options.inactivityMs);
  const now = options.now || (() => Date.now());
  const schedule = options.schedule || setTimeout;
  const cancel = options.cancel || clearTimeout;
  const activeSessions = new Map();

  function clearTimer(state) {
    if (state?.timer !== undefined && state?.timer !== null) {
      cancel(state.timer);
      state.timer = null;
    }
  }

  function deactivateByKey(key) {
    const state = activeSessions.get(key);
    if (!state) return false;
    clearTimer(state);
    activeSessions.delete(key);
    return true;
  }

  function scheduleExpiry(key, state) {
    clearTimer(state);
    const delay = Math.max(0, state.expiresAt - now());
    state.timer = schedule(() => {
      const current = activeSessions.get(key);
      if (current !== state) return;
      if (current.expiresAt <= now()) {
        activeSessions.delete(key);
        return;
      }
      scheduleExpiry(key, current);
    }, delay);
  }

  function activate(session, game) {
    const key = getGameMiniSessionKey(session);
    if (!key || !GAME_MINI_ACTIVE_GAME_COMMAND_NAME_SET.has(game)) return false;
    const existing = activeSessions.get(key);
    if (existing && existing.expiresAt > now()) return touch(session);
    if (existing) deactivateByKey(key);
    const state = {
      game,
      expiresAt: now() + inactivityMs,
      timer: null,
    };
    activeSessions.set(key, state);
    scheduleExpiry(key, state);
    return true;
  }

  function deactivate(session, expectedGame = '') {
    const key = getGameMiniSessionKey(session);
    const state = key && activeSessions.get(key);
    if (!state || (expectedGame && state.game !== expectedGame)) return false;
    return deactivateByKey(key);
  }

  function isActive(session) {
    const key = getGameMiniSessionKey(session);
    if (!key) return false;
    const state = activeSessions.get(key);
    if (!state) return false;
    if (state.expiresAt <= now()) {
      deactivateByKey(key);
      return false;
    }
    return true;
  }

  function touch(session) {
    const key = getGameMiniSessionKey(session);
    const state = key && activeSessions.get(key);
    if (!state || state.expiresAt <= now()) {
      if (state) deactivateByKey(key);
      return false;
    }
    state.expiresAt = now() + inactivityMs;
    scheduleExpiry(key, state);
    return true;
  }

  function observe(session) {
    if (!isGroupGameSession(session)) return false;
    const commandName = getGameMiniCommandName(session);
    if (GAME_MINI_ACTIVE_GAME_COMMAND_NAME_SET.has(commandName)) {
      const action = getGameMiniCommandAction(session);
      if (action === '开始') return activate(session, commandName);
      if (action === '结束') return deactivate(session, commandName);
    }
    return isActive(session) ? touch(session) : false;
  }

  function observeGameOutput(session, content) {
    if (!isActive(session)) return false;
    const output = String(content || '');
    if (!GAME_MINI_END_MESSAGE_MARKERS.some((marker) => output.includes(marker))) return false;
    return deactivate(session);
  }

  function dispose() {
    for (const state of activeSessions.values()) clearTimer(state);
    activeSessions.clear();
  }

  return {
    activate,
    deactivate,
    dispose,
    isActive,
    observe,
    observeGameOutput,
    touch,
  };
}

export function installGameMiniSessionBoundary(ctx, controller) {
  if (!controller) return;

  ctx.middleware(async (session, next) => {
    controller.observe(session);
    const originalSend = session?.send;
    if (typeof originalSend !== 'function') return next();

    session.send = async (...args) => {
      const result = await originalSend.apply(session, args);
      controller.observeGameOutput(session, args[0]);
      return result;
    };
    try {
      return await next();
    } finally {
      session.send = originalSend;
    }
  });

  ctx.on('dispose', () => controller.dispose());
}

export function isGameMiniDirectCommand(session = {}) {
  return GAME_MINI_COMMAND_NAME_SET.has(getGameMiniCommandName(session));
}

export function shouldInstallGameMini(runtimeConfig = {}, mode = 'active') {
  return Boolean(runtimeConfig.gameMiniEnabled)
    && String(mode || runtimeConfig.yunoPluginMode || 'active').toLowerCase() === 'active';
}

export function assertGameMiniPrerequisites(runtimeConfig = {}, mode = 'active') {
  if (!shouldInstallGameMini(runtimeConfig, mode)) return;
  if (runtimeConfig.koishiConsoleEnabled) return;

  const error = new Error('GAME_MINI_REQUIRES_KOISHI_CONSOLE');
  error.code = 'GAME_MINI_REQUIRES_KOISHI_CONSOLE';
  throw error;
}
