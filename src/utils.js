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

export function extractAtTargets(value) {
  const message = String(value || '');
  const targets = [];

  for (const match of message.matchAll(/\[CQ:at,qq=([^\],]+)[^\]]*\]/g)) {
    const qq = String(match[1] || '').trim();
    if (!qq || targets.includes(qq)) continue;
    targets.push(qq);
  }

  return targets;
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

  if (/(讨厌|闭嘴|垃圾|可恶|生气|烦死|糟糕|hate|annoyed|angry)/i.test(normalized)) {
    return 'negative';
  }

  if (/(喜欢|爱你|谢谢|辛苦|厉害|可爱|抱抱|开心|love|thanks|great)/i.test(normalized)) {
    return 'positive';
  }

  return 'neutral';
}

export function inferIntent(text) {
  const normalized = stripCqCodes(text);
  if (!normalized) return 'ignore';
  if (/(帮助|帮我|怎么|如何|为啥|为什么|问题|命令|help)/i.test(normalized)) return 'help';
  if (/(你是谁|介绍|自我介绍)/i.test(normalized)) return 'identity';
  if (/(状态|关系|好感|画像|群状态|情绪|profile|relation)/i.test(normalized)) return 'query';
  if (/(闭嘴|别说话|讨厌你|滚开)/i.test(normalized)) return 'challenge';
  if (/(早安|晚安|你好|在吗|hello|hi)/i.test(normalized)) return 'social';
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
