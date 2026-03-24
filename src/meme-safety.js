const PHONE_PATTERN = /\b1\d{10}\b/;
const SENSITIVE_PATTERN = /\b(address|phone|id\s*card|passport|bank|secret)\b/i;
const ABUSE_PATTERN = /\b(kill|suicide|doxx|harass)\b/i;
const CHINESE_SENSITIVE_PATTERN = /[\u7535\u8bdd\u624b\u673a\u5730\u5740\u8eab\u4efd\u8bc1\u9690\u79c1]/u;
const CHINESE_ABUSE_PATTERN = /[\u8fb1\u9a82\u9738\u51cc\u81ea\u6740\u8ddf\u8e2a\u5a01\u80c1]/u;

export function assessMemeSafety({ text = '', attachments = [], username = '' } = {}) {
  const content = `${text} ${username}`.trim();
  const flags = [];

  if (PHONE_PATTERN.test(content) || SENSITIVE_PATTERN.test(content) || CHINESE_SENSITIVE_PATTERN.test(content)) {
    flags.push('privacy');
  }

  if (ABUSE_PATTERN.test(content) || CHINESE_ABUSE_PATTERN.test(content)) {
    flags.push('abuse');
  }

  if (Array.isArray(attachments) && attachments.some((item) => item.type === 'record' || item.type === 'video')) {
    flags.push('unsupported-attachment');
  }

  return {
    allowed: flags.length === 0,
    safetyStatus: flags.length === 0 ? 'safe' : 'blocked',
    safetyFlags: flags,
  };
}
