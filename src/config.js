import dotenv from 'dotenv';

dotenv.config();

function readNumber(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: readNumber('PORT', 3000),
  mongodbUri: process.env.MONGODB_URI || '',
  mongoMaxPoolSize: readNumber('MONGO_MAX_POOL_SIZE', 10),
  siliconflowApiKey: process.env.SILICONFLOW_API_KEY || '',
  napcatApi: (process.env.NAPCAT_API || '').replace(/\/+$/, ''),
  napcatToken: process.env.NAPCAT_TOKEN || '',
  targetGroupId: process.env.TARGET_GROUP_ID ? String(process.env.TARGET_GROUP_ID) : '',
  adminQq: process.env.ADMIN_QQ ? String(process.env.ADMIN_QQ) : '',
  yunoVoiceUri: process.env.YUNO_VOICE_URI || '',
  requestTimeoutMs: readNumber('REQUEST_TIMEOUT_MS', 15000),
  retryAttempts: readNumber('RETRY_ATTEMPTS', 2),
  retryDelayMs: readNumber('RETRY_DELAY_MS', 400),
});

export function validateRuntimeConfig() {
  const required = [
    ['MONGODB_URI', config.mongodbUri],
    ['SILICONFLOW_API_KEY', config.siliconflowApiKey],
    ['NAPCAT_API', config.napcatApi],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function isAdvancedGroup(groupId) {
  return Boolean(config.targetGroupId) && String(groupId) === config.targetGroupId;
}
