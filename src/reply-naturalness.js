import { normalizeWhitespace } from './utils.js';

const AI_DISCLAIMER_REGEX = /(作为(?:一个)?\s*(?:AI|人工智能|语言模型)|我是(?:一个)?\s*(?:AI|人工智能|语言模型)|身为(?:一个)?\s*(?:AI|人工智能))/i;
const AI_DISCLAIMER_SENTENCE_REGEX = /(?:作为(?:一个)?\s*(?:AI|人工智能|语言模型)|我是(?:一个)?\s*(?:AI|人工智能|语言模型)|身为(?:一个)?\s*(?:AI|人工智能))[^。！？!?]*(?:[。！？!?]|$)/gi;
const CANNED_EMPATHY_REGEX = /(我理解你的感受|我能理解你的感受|我明白你的感受|我能明白你的感受)/;
const SUMMARY_PREFACE_REGEX = /(总结一下|总之|简单来说)\s*[:：]/;
const STRUCTURED_LINE_REGEX = /^\s*(?:[-*+]\s+|\d+[.)、]\s+|[一二三四五六七八九十]+[、.]\s*)/;
const GENERIC_PRESENCE_PREFIX_REGEX = /^(?:嗯[，,。]?\s*|好[，,。]?\s*)?我在(?:这儿)?[。！!?]?\s*/;
const GENERIC_COMPANIONSHIP_HOOK_REGEX = /(先说哪件|想聊什么|你想说什么|随便说点什么)[？?。！!]?\s*$/;

const MOTIVE_ATTRIBUTION_REGEX = /(你(?:每次|总是|就是|只是|明明|偏偏|非要|硬要|根本)|找借口|蒙混过关|被(?:我|你)说中|揣测|把[^。！？!?，,]{0,18}(?:责任|账)[^。！？!?，,]{0,12}(?:扔|推|算)|赖着|装作|故意骗)/;
const ACCUSATORY_FRAME_REGEX = /(?:你(?:又|居然|怎么还)|明明[^。！？!?]{0,24}(?:却|还|倒是)|嫌[^。！？!?]{0,24}还|你就这么)/;
const ADVERSARIAL_CONTRAST_REGEX = /(?:倒是[^。！？!?]{0,24}(?:就|还|一点)|明明[^。！？!?]{0,24}(?:却|还)|嫌[^。！？!?]{0,24}还)/;
const POSSESSIVE_CONTROL_REGEX = /(不许|不准|只能|你只能|别(?:走|离开|消失|不理我)|不可以[^。！？!?]{0,12}(?:跟|和)[^。！？!?]{0,12}(?:别人|他人))/;
const PERSONAL_ATTACK_REGEX = /(?:你(?:很|太)?(?:自私|虚伪|恶心|可笑|烦人|麻烦|没救)|废物|蠢货|闭嘴)/;
const ROBOTIC_ACKNOWLEDGEMENT_REGEX = /(?:我(?:(?:已经|会|先|都|也|替你)\s*)*(?:记下|记住|记着|收下|接住)(?:了|啦|这句|这件事|你(?:这句|说的(?:话|内容)))?|这(?:句|句话|件事|条(?:偏好|订阅|提醒)?|个(?:要求|约定)?)(?:我)?(?:(?:已经|会|先|都|也|替你)\s*)*(?:记下|记住|记着|收下|接住)(?:了|啦)?|我(?:听见|听到|知道|明白|了解)(?:了|啦)|(?:(?:已经|都|这就)\s*)?(?:记下|记住|收下|接住)(?:了|啦)|(?:已经|已)?收到(?:了|啦)?)/;
const EMOJI_DETECT_REGEX = /\p{Extended_Pictographic}/u;
const EMOJI_REPLACE_REGEX = /\p{Extended_Pictographic}/gu;
const KAOMOJI_REGEX = /(?:\((?=[^)\r\n]{2,16}\))(?=[^)\r\n]*[｡・ωへ｀´▽ﾉ￣^><≧≦つっヾ；;])[^)\r\n]+\)|[=;:][\-^']?[)(DP]|[｡・ωへ｀´▽ﾉ￣]{3,})/gu;

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

function recentAssistantMessages(options = {}, limit = 3) {
  const messages = options.conversationState?.messages || options.recentAssistantMessages || [];
  return messages
    .filter((item) => item?.role === 'assistant' || !item?.role)
    .slice(-limit);
}

function uniqueFlags(flags) {
  return [...new Set(flags)];
}

function questionCount(value) {
  return (String(value || '').match(/[？?]/g) || []).length;
}

function hasEmojiOrKaomoji(value) {
  return EMOJI_DETECT_REGEX.test(String(value || ''))
    || new RegExp(KAOMOJI_REGEX.source, 'u').test(String(value || ''));
}

function compactTemplate(value) {
  return String(value || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？!?、；;：:,.!?]/g, '')
    .replace(/[“”‘’"'`~～]/g, '')
    .trim();
}

function buildTemplateSignature(value) {
  return compactTemplate(value).slice(0, 12);
}

function buildTrigrams(value) {
  const normalized = compactTemplate(value);
  const result = new Set();
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    result.add(normalized.slice(index, index + 3));
  }
  return result;
}

function trigramSimilarity(left, right) {
  const first = buildTrigrams(left);
  const second = buildTrigrams(right);
  if (first.size === 0 || second.size === 0) return 0;
  let intersection = 0;
  for (const item of first) {
    if (second.has(item)) intersection += 1;
  }
  return intersection / (first.size + second.size - intersection);
}

function hasRepeatedTemplate(value, options = {}) {
  const signature = buildTemplateSignature(value);
  if (signature.length < 6) return false;
  return recentAssistantMessages(options, 3).some((item) => {
    const previous = String(item.content || '');
    const previousSignature = buildTemplateSignature(previous);
    return previousSignature.length >= 6
      && (signature === previousSignature || trigramSimilarity(value, previous) >= 0.58);
  });
}

function isExpectedQuestion(options = {}) {
  return options.replyPlan?.questionNeeded === true;
}

function shouldRewriteForEdge({ edgeScore, hard, previousEdgeScore, options }) {
  if (hard || edgeScore >= 2 || (previousEdgeScore > 0 && edgeScore > 0)) return true;
  if (edgeScore <= 0) return false;
  const move = options.personalityStrategy?.signatureMove?.key;
  const allowedMove = move === 'mild_edge';
  return !allowedMove && options.messageAnalysis?.intent !== 'challenge';
}

export function inspectReplyNaturalness(text, options = {}) {
  const value = String(text || '').trim();
  const flags = [];
  let edgeScore = 0;

  if (AI_DISCLAIMER_REGEX.test(value)) flags.push('ai-disclaimer');
  if (CANNED_EMPATHY_REGEX.test(value)) flags.push('canned-empathy');
  if (SUMMARY_PREFACE_REGEX.test(value)) flags.push('summary-preface');
  if (ROBOTIC_ACKNOWLEDGEMENT_REGEX.test(value)) flags.push('robotic-acknowledgement');

  const hasMotiveAttribution = MOTIVE_ATTRIBUTION_REGEX.test(value);
  const hasAccusatoryFrame = ACCUSATORY_FRAME_REGEX.test(value);
  const hasAdversarialContrast = ADVERSARIAL_CONTRAST_REGEX.test(value);
  const hasPossessiveControl = POSSESSIVE_CONTROL_REGEX.test(value);
  const hasPersonalAttack = PERSONAL_ATTACK_REGEX.test(value);
  const questions = questionCount(value);
  const unnecessaryQuestion = questions > 0
    && !isExpectedQuestion(options)
    && (hasMotiveAttribution
      || hasAccusatoryFrame
      || /(?:难道|凭什么|你(?:就|还|怎么|到底))[^。！？!?]{0,32}[？?]/.test(value));
  const stackedQuestions = questions >= 2;
  const repeatedTemplate = hasRepeatedTemplate(value, options);
  const previousEdgeScore = Number(recentAssistantMessages(options, 2).at(-1)?.edgeScore || 0);
  const repeatedEmoji = hasEmojiOrKaomoji(value)
    && recentAssistantMessages(options, 2).some((item) => hasEmojiOrKaomoji(item.content));
  const privateLengthLimit = options.messageAnalysis?.intent === 'help' ? 110 : 72;
  const privateTooLong = options.event?.chatType === 'private'
    && !isKnowledgeRoute(options)
    && normalizeWhitespace(value).length > privateLengthLimit;

  if (hasMotiveAttribution) {
    flags.push('unsupported-motive-attribution');
    edgeScore += 2;
  }
  if (hasAccusatoryFrame) {
    flags.push('accusatory-you-frame');
    edgeScore += 1;
  }
  if (hasAdversarialContrast) {
    flags.push('adversarial-contrast-frame');
    edgeScore += 1;
  }
  if (hasPossessiveControl) {
    flags.push('possessive-control');
    edgeScore += 3;
  }
  if (hasPersonalAttack) {
    flags.push('personal-attack');
    edgeScore += 2;
  }
  if (unnecessaryQuestion || stackedQuestions) {
    flags.push('stacked-rhetorical-questions');
    edgeScore += stackedQuestions ? 2 : 1;
  }
  if (repeatedTemplate) {
    flags.push('repeated-template');
    edgeScore += 1;
  }
  if (repeatedEmoji) flags.push('repeated-emoji');
  if (privateTooLong) flags.push('private-too-long');
  if (previousEdgeScore > 0 && edgeScore > 0) {
    flags.push('repeated-edge');
    edgeScore += 2;
  }

  if (isGroupChat(options) && !isKnowledgeRoute(options)) {
    if (countStructuredLines(value) >= 2) flags.push('group-structured-panel');
    if (normalizeWhitespace(value).length > 260) flags.push('group-too-long');
  }

  const unique = uniqueFlags(flags);
  const hardFlags = [
    'unsupported-motive-attribution',
    'possessive-control',
    'personal-attack',
    'repeated-edge',
  ];
  const hard = unique.some((flag) => hardFlags.includes(flag));
  const rewriteRecommended = unique.includes('private-too-long')
    || unique.includes('robotic-acknowledgement')
    || shouldRewriteForEdge({
    edgeScore,
    hard,
    previousEdgeScore,
    options,
  });
  const severity = hard || edgeScore >= 2 ? 'hard' : edgeScore > 0 ? 'soft' : 'none';

  return {
    ok: unique.length === 0,
    flags: unique,
    edgeScore,
    severity,
    hard,
    rewriteRecommended,
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

function removeAggressiveClauses(text) {
  const clauses = String(text || '')
    .split(/(?<=[，,。！？!?；;])/)
    .map((item) => item.trim())
    .filter(Boolean);
  const safe = clauses.filter((clause) => !(
    MOTIVE_ATTRIBUTION_REGEX.test(clause)
    || ACCUSATORY_FRAME_REGEX.test(clause)
    || ADVERSARIAL_CONTRAST_REGEX.test(clause)
    || POSSESSIVE_CONTROL_REGEX.test(clause)
    || PERSONAL_ATTACK_REGEX.test(clause)
  ));
  return safe.join('').trim();
}
function removeRoboticAcknowledgementClauses(text) {
  const clauses = String(text || '')
    .split(/(?<=[，,。！？!?；;])/)
    .map((item) => item.trim())
    .filter(Boolean);
  return clauses
    .filter((clause) => !ROBOTIC_ACKNOWLEDGEMENT_REGEX.test(clause))
    .join('')
    .trim();
}


function limitQuestions(text, options = {}) {
  const allowed = options.replyPlan?.questionNeeded ? 1 : 0;
  const sentences = String(text || '').match(/[^。！？!?]+[。！？!?]?/g) || [];
  const questionIndexes = sentences
    .map((sentence, index) => /[？?]/.test(sentence) ? index : -1)
    .filter((index) => index >= 0);
  const keepQuestionIndex = allowed > 0 ? questionIndexes.at(-1) : -1;

  return sentences
    .filter((sentence, index) => !/[？?]/.test(sentence) || index === keepQuestionIndex)
    .map((sentence) => sentence.replace(/[？?]+$/, '？'))
    .join('')
    .trim();
}

function shortenPrivateReply(text, options = {}) {
  if (options.event?.chatType !== 'private' || isKnowledgeRoute(options)) return text;
  const limit = options.messageAnalysis?.intent === 'help' ? 110 : 72;
  const value = String(text || '').trim();
  if (value.length <= limit) return value;

  const sentences = value.match(/[^。！？!?]+[。！？!?]?/g) || [value];
  let output = '';
  for (const sentence of sentences.slice(0, 2)) {
    if ((output + sentence).length > limit) break;
    output += sentence;
  }
  if (output.length >= 4) return output.trim();
  return `${value.slice(0, Math.max(1, limit - 1)).replace(/[，,；;：:]$/, '')}。`;
}

export function buildDeescalatedReplyFallback(options = {}) {
  const intent = String(options.messageAnalysis?.intent || options.analysis?.intent || '').toLowerCase();
  const sentiment = String(options.messageAnalysis?.sentiment || options.analysis?.sentiment || '').toLowerCase();
  if (intent === 'help' || sentiment === 'negative') return '先别硬撑。今天可以慢一点。';
  if (intent === 'challenge') return '我不同意。先把重点说清楚。';
  if (sentiment === 'positive') return '嗯，听你这么说，我有点高兴。只是没打算表现得太明显。';
  return '嗯，你继续说。我想听后面。';
}

export function deescalateReplyNaturalness(text, options = {}) {
  const original = String(text || '').trim();
  if (!original) return buildDeescalatedReplyFallback(options);
  const hadRoboticAcknowledgement = ROBOTIC_ACKNOWLEDGEMENT_REGEX.test(original);
  const safeClauses = removeRoboticAcknowledgementClauses(removeAggressiveClauses(original));
  const output = shortenPrivateReply(limitQuestions(safeClauses, options), options)
    .replace(/\s*([，。！？!?、；;：:])\s*/g, '$1')
    .trim();
  const residualTooThin = hadRoboticAcknowledgement
    && (normalizeWhitespace(output).length < 10 || /^(?:嗯[，,]?)?(?:别得意|好吧|行吧|知道啦)[。！？!?]?$/.test(output));

  if (!residualTooThin && output.length >= 4 && !MOTIVE_ATTRIBUTION_REGEX.test(output) && !POSSESSIVE_CONTROL_REGEX.test(output)) {
    return output;
  }
  return buildDeescalatedReplyFallback(options);
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

  if (options.personalityStrategy?.emojiPolicy?.allowed === false) {
    output = output
      .replace(EMOJI_REPLACE_REGEX, '')
      .replace(KAOMOJI_REGEX, '');
  }

  return normalizeWhitespace(output)
    .replace(/\s*([，。！？!?、；;：:])\s*/g, '$1')
    .trim() || original;
}
