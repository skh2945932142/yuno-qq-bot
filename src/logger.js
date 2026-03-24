const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeLevel(level) {
  return String(level || 'info').trim().toLowerCase();
}

function shouldLog(currentLevel, targetLevel) {
  return (LEVEL_PRIORITY[targetLevel] || LEVEL_PRIORITY.info) >= (LEVEL_PRIORITY[currentLevel] || LEVEL_PRIORITY.info);
}

function write(level, category, message, meta = {}, currentLevel = 'info') {
  const normalizedLevel = normalizeLevel(level);
  if (!shouldLog(currentLevel, normalizedLevel)) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level: normalizedLevel,
    category,
    message,
    ...Object.fromEntries(
      Object.entries(meta || {}).filter(([, value]) => value !== undefined)
    ),
  };

  const sink = normalizedLevel === 'error'
    ? console.error
    : normalizedLevel === 'warn'
      ? console.warn
      : console.log;

  sink(JSON.stringify(payload));
}

export function createLogger(options = {}) {
  const level = normalizeLevel(options.level || process.env.LOG_LEVEL || 'info');
  const defaults = options.defaults || {};

  function logAt(targetLevel, category, message, meta) {
    write(targetLevel, category, message, { ...defaults, ...(meta || {}) }, level);
  }

  return {
    debug(category, message, meta) {
      logAt('debug', category, message, meta);
    },
    info(category, message, meta) {
      logAt('info', category, message, meta);
    },
    warn(category, message, meta) {
      logAt('warn', category, message, meta);
    },
    error(category, message, meta) {
      logAt('error', category, message, meta);
    },
    child(meta = {}) {
      return createLogger({
        level,
        defaults: { ...defaults, ...meta },
      });
    },
  };
}

export const logger = createLogger();
