export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function uniqueCompact(values, limit = 5) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }

  return result;
}

export function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function stripCqCodes(value) {
  return normalizeWhitespace(String(value || '').replace(/\[CQ:[^\]]+\]/g, ' '));
}

export function extractTopics(text) {
  const normalized = stripCqCodes(text);
  const asciiTopics = normalized
    .toLowerCase()
    .match(/[a-z]{3,}/g) || [];
  const chineseTopics = normalized.match(/[\u4e00-\u9fa5]{2,6}/g) || [];

  return uniqueCompact([...chineseTopics, ...asciiTopics], 5);
}

export function inferSentiment(text) {
  const normalized = stripCqCodes(text);
  if (!normalized) return 'neutral';

  if (/(讨厌|烦|滚|闭嘴|笨|垃圾|可恶|生气|怒|恨)/i.test(normalized)) {
    return 'negative';
  }

  if (/(喜欢|爱|谢谢|辛苦|厉害|可爱|抱抱|好耶|开心)/i.test(normalized)) {
    return 'positive';
  }

  return 'neutral';
}

export function inferIntent(text) {
  const normalized = stripCqCodes(text);
  if (!normalized) return 'ignore';
  if (/(帮助|帮我|怎么|如何|为啥|为什么|问题|命令)/i.test(normalized)) return 'help';
  if (/(你是谁|介绍|自我介绍)/i.test(normalized)) return 'identity';
  if (/(状态|关系|好感|画像|群状态|情绪)/i.test(normalized)) return 'query';
  if (/(滚|闭嘴|别说话|讨厌你)/i.test(normalized)) return 'challenge';
  if (/(早安|晚安|你好|嗨|在吗)/i.test(normalized)) return 'social';
  return 'chat';
}

export function extractPreferences(text) {
  const normalized = stripCqCodes(text);
  const matches = [];

  const patterns = [
    /(?:我)?喜欢([\u4e00-\u9fa5A-Za-z0-9]{1,12})/g,
    /(?:我)?想要([\u4e00-\u9fa5A-Za-z0-9]{1,12})/g,
    /(?:我)?讨厌([\u4e00-\u9fa5A-Za-z0-9]{1,12})/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      matches.push(match[1]);
    }
  }

  return uniqueCompact(matches, 4);
}

export function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
