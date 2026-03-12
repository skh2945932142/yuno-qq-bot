function log(level, category, message, meta) {
  const prefix = `[${new Date().toISOString()}] [${level}] [${category}]`;
  if (meta && Object.keys(meta).length > 0) {
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](prefix, message, meta);
    return;
  }

  console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](prefix, message);
}

export const logger = {
  info(category, message, meta) {
    log('INFO', category, message, meta);
  },
  warn(category, message, meta) {
    log('WARN', category, message, meta);
  },
  error(category, message, meta) {
    log('ERROR', category, message, meta);
  },
};
