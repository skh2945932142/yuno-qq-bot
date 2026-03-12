function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryError(error) {
  if (!error) return false;

  const status = error.response?.status;
  if (typeof status === 'number') {
    return status >= 500 || status === 429;
  }

  const code = error.code || '';
  return [
    'ECONNABORTED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EAI_AGAIN',
  ].includes(code);
}

export async function withRetry(task, options = {}) {
  const {
    retries = 0,
    delayMs = 250,
    category = 'retry',
    label = 'task',
    logger,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetryError(error)) {
        throw error;
      }

      logger?.warn(category, `${label} failed, retrying`, {
        attempt: attempt + 1,
        code: error.code,
        status: error.response?.status,
      });
      await sleep(delayMs * (attempt + 1));
    }
  }

  throw lastError;
}
