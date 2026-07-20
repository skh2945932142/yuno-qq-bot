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

  if (/(����|����|����|�ɶ�|����|����|���|hate|annoyed|angry)/i.test(normalized)) {
    return 'negative';
  }

  if (/(ϲ��|����|лл|����|����|�ɰ�|����|����|love|thanks|great)/i.test(normalized)) {
    return 'positive';
  }

  return 'neutral';
}

export function inferIntent(text) {
  const normalized = stripCqCodes(text);
  if (!normalized) return 'ignore';
  if (/(����|����|��ô|���|Ϊɶ|Ϊʲô|����|����|help)/i.test(normalized)) return 'help';
  if (/(����˭|����|���ҽ���)/i.test(normalized)) return 'identity';
  if (/(״̬|��ϵ|�ø�|����|Ⱥ״̬|����|profile|relation)/i.test(normalized)) return 'query';
  if (/(����|��˵��|������|����)/i.test(normalized)) return 'challenge';
  if (/(�簲|����|���|����|hello|hi)/i.test(normalized)) return 'social';
  return 'chat';
}

export function extractPreferences(text) {
  const normalized = stripCqCodes(text);
  const matches = [];

  const patterns = [
    /(?:��)?ϲ��([\u4e00-\u9fa5A-Za-z0-9]{1,12})/g,
    /(?:��)?��Ҫ([\u4e00-\u9fa5A-Za-z0-9]{1,12})/g,
    /(?:��)?����([\u4e00-\u9fa5A-Za-z0-9]{1,12})/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      matches.push(match[1]);
    }
  }

  return uniqueCompact(matches, 4);
}

export function safeJsonParse(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  // 尝试直接解析
  try {
    return JSON.parse(value);
  } catch {
    // 如果失败，尝试提取 JSON 对象
  }

  // 移除常见的前缀说明（Gemini 等模型会添加）
  const prefixes = [
    /^Here is the JSON[^{]*/i,
    /^Here's the JSON[^{]*/i,
    /^The JSON[^{]*/i,
    /^JSON[^{]*/i,
    /^```json\s*/i,
    /^```\s*/i,
  ];

  let cleaned = value.trim();
  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, '');
  }

  // 移除末尾的代码块标记
  cleaned = cleaned.replace(/\s*```\s*$/i, '');

  // 提取第一个完整的 JSON 对象或数组
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // 继续尝试其他方法
    }
  }

  // 最后尝试清理后的整个字符串
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
