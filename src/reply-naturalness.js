import { normalizeWhitespace } from './utils.js';

const AI_DISCLAIMER_REGEX = /(作为(?:一个)?\s*(?:AI|人工智能|语言模型)|我是(?:一个)?\s*(?:AI|人工智能|语言模型)|身为(?:一个)?\s*(?:AI|人工智能))/i;
const AI_DISCLAIMER_SENTENCE_REGEX = /(?:作为(?:一个)?\s*(?:AI|人工智能|语言模型)|我是(?:一个)?\s*(?:AI|人工智能|语言模型)|身为(?:一个)?\s*(?:AI|人工智能))[^。！？!?]*(?:[。！？!?]|$)/gi;
const CANNED_EMPATHY_REGEX = /(我理解你的感受|我能理解你的感受|我明白你的感受|我能明白你的感受)/;
const SUMMARY_PREFACE_REGEX = /(总结一下|总之|简单来说)\s*[:：]/;
const STRUCTURED_LINE_REGEX = /^\s*(?:[-*+]\s+|\d+[.)、]\s+|[一二三四五六七八九十]+[、.]\s*)/;
const GENERIC_PRESENCE_PREFIX_REGEX = /^(?:嗯[，,。]?\s*|好[，,。]?\s*)?我在(?:这儿)?[。！!?]?\s*/;
const GENERIC_COMPANIONSHIP_HOOK_REGEX = /(先说哪件|想聊什么|你想说什么|随便说点什么)[？?。！!]?\s*$/;

function isGroupChat(options = {}) {
  return options.event?.chatType === 'group';
}

function isKnowledgeRoute(options = {}) {
  return options.route?.category === 'knowledge_qa';
}

function countStructuredLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => STRUCTURED_LINE_REGEX.test(line)).length;
}

function uniqueFlags(flags) {
  return [...new Set(flags)];
}

export function inspectReplyNaturalness(text, options = {}) {
  const value = String(text || '').trim();
  const flags = [];

  if (AI_DISCLAIMER_REGEX.test(value)) flags.push('ai-disclaimer');
  if (CANNED_EMPATHY_REGEX.test(value)) flags.push('canned-empathy');
  if (SUMMARY_PREFACE_REGEX.test(value)) flags.push('summary-preface');

  if (isGroupChat(options) && !isKnowledgeRoute(options)) {
    if (countStructuredLines(value) >= 2) {
      flags.push('group-structured-panel');
    }
    if (normalizeWhitespace(value).length > 260) {
      flags.push('group-too-long');
    }
  }

  const unique = uniqueFlags(flags);
  return {
    ok: unique.length === 0,
    flags: unique,
  };
}

function removeCannedEmpathy(text) {
  return String(text || '')
    .replace(/我(?:能)?理解你的感受[，,。！？!?]?\s*/g, '')
    .replace(/我(?:能)?明白你的感受[，,。！？!?]?\s*/g, '');
}

function removeSummaryPreface(text) {
  return String(text || '').replace(/(?:总结一下|总之|简单来说)\s*[:：]\s*/g, '');
}

function flattenGroupPanel(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(STRUCTURED_LINE_REGEX, '').trim())
    .filter(Boolean);
  return lines.join(' ');
}

function polishDirectAttentionHook(text, options = {}) {
  if (
    options.event?.chatType !== 'private'
    || options.personalityStrategy?.signatureMove?.key !== 'direct_attention'
  ) {
    return text;
  }

  let output = String(text || '').trim();
  if (GENERIC_PRESENCE_PREFIX_REGEX.test(output)) {
    output = output.replace(GENERIC_PRESENCE_PREFIX_REGEX, '行，这会儿先听你的。');
  }

  if (GENERIC_COMPANIONSHIP_HOOK_REGEX.test(output)) {
    const input = String(options.event?.rawText || options.event?.text || '');
    const hook = /(累|疲惫|烦|忙|压力)/.test(input)
      ? '先挑今天最耗你的那一件说。'
      : '先把现在最占你注意力的那一件说。';
    output = output.replace(GENERIC_COMPANIONSHIP_HOOK_REGEX, hook);
  }

  return output;
}

export function polishReplyNaturalness(text, options = {}) {
  const original = String(text || '').trim();
  if (!original) return '';

  const inspection = inspectReplyNaturalness(original, options);
  const directAttentionOutput = polishDirectAttentionHook(original, options);
  if (inspection.ok && directAttentionOutput === original) return original;

  let output = original
    .replace(AI_DISCLAIMER_SENTENCE_REGEX, '')
    .trim();
  output = removeCannedEmpathy(output);
  output = removeSummaryPreface(output);

  if (
    inspection.flags.includes('group-structured-panel')
    && isGroupChat(options)
    && !isKnowledgeRoute(options)
  ) {
    output = flattenGroupPanel(output);
  }

  output = polishDirectAttentionHook(output, options);

  output = normalizeWhitespace(output)
    .replace(/\s*([，。！？!?、；;：:])\s*/g, '$1')
    .trim();

  return output || original;
}
