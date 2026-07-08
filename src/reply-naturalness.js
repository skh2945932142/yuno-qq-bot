import { normalizeWhitespace } from './utils.js';

const AI_DISCLAIMER_REGEX = /(作为(?:一个)?\s*(?:AI|人工智能|语言模型)|我是(?:一个)?\s*(?:AI|人工智能|语言模型)|身为(?:一个)?\s*(?:AI|人工智能))/i;
const AI_DISCLAIMER_SENTENCE_REGEX = /(?:作为(?:一个)?\s*(?:AI|人工智能|语言模型)|我是(?:一个)?\s*(?:AI|人工智能|语言模型)|身为(?:一个)?\s*(?:AI|人工智能))[^。！？!?]*(?:[。！？!?]|$)/gi;
const CANNED_EMPATHY_REGEX = /(我理解你的感受|我能理解你的感受|我明白你的感受|我能明白你的感受)/;
const SUMMARY_PREFACE_REGEX = /(总结一下|总之|简单来说)\s*[:：]/;
const STRUCTURED_LINE_REGEX = /^\s*(?:[-*+]\s+|\d+[.)、]\s+|[一二三四五六七八九十]+[、.]\s*)/;

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

export function polishReplyNaturalness(text, options = {}) {
  const original = String(text || '').trim();
  if (!original) return '';

  const inspection = inspectReplyNaturalness(original, options);
  if (inspection.ok) return original;

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

  output = normalizeWhitespace(output)
    .replace(/\s*([，。！？!?、；;：:])\s*/g, '$1')
    .trim();

  return output || original;
}
