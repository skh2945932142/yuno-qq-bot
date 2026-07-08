import { normalizeWhitespace } from './utils.js';

const MEME_REGEX = /(笑死|抽象|蚌埠住|绷不住|离谱|逆天|乐子|草|www|2333|hhh)/i;
const TEXT_EMOTE_REGEX = /(QAQ|QWQ|qwq|www|2333|hhh|哈哈哈+|\([^)）]{1,6}[)）]|（[^)）]{1,6}[)）])/i;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

function classifyReplyLength(averageLength) {
  if (averageLength <= 28) return 'short';
  if (averageLength <= 80) return 'balanced';
  return 'long';
}

function classifyHumorStyle(memeRate) {
  if (memeRate >= 0.35) return 'meme-heavy';
  if (memeRate >= 0.12) return 'light-meme';
  return 'plain';
}

function classifyExpressiveStyle({ emojiRate, textEmoteRate }) {
  if (emojiRate >= 0.2) return 'emoji-heavy';
  if (textEmoteRate >= 0.25) return 'text-emote';
  return 'restrained';
}

function mergeAverage(previousAverage, previousCount, nextValue) {
  if (previousCount <= 0) return nextValue;
  return ((previousAverage * previousCount) + nextValue) / (previousCount + 1);
}

export function summarizeGroupStylePrompt(profile = {}) {
  const segments = [];

  if (profile.replyLength === 'short') {
    segments.push('偏短句');
  } else if (profile.replyLength === 'long') {
    segments.push('容易长段展开');
  } else {
    segments.push('长度均衡');
  }

  if (profile.humorStyle === 'meme-heavy') {
    segments.push('玩梗密度高');
  } else if (profile.humorStyle === 'light-meme') {
    segments.push('偶尔接梗');
  }

  if (profile.expressiveStyle === 'emoji-heavy') {
    segments.push('emoji 较多');
  } else if (profile.expressiveStyle === 'text-emote') {
    segments.push('常用文字表情');
  }

  if (Array.isArray(profile.recentTopics) && profile.recentTopics.length > 0) {
    segments.push(`常聊${profile.recentTopics.slice(0, 3).join('/')}`);
  }

  return `群风格${segments.join('，')}`;
}

export function updateGroupStyleProfile(current = null, { text = '', analysis = {} } = {}) {
  const previous = current || {};
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return {
      ...previous,
      promptSummary: previous.promptSummary || summarizeGroupStylePrompt(previous),
    };
  }

  const previousCount = Math.max(0, Number(previous.sampleCount || 0));
  const sampleCount = previousCount + 1;
  const lengthValue = normalized.length;
  const memeValue = MEME_REGEX.test(normalized) ? 1 : 0;
  const emojiValue = EMOJI_REGEX.test(normalized) ? 1 : 0;
  const textEmoteValue = TEXT_EMOTE_REGEX.test(normalized) ? 1 : 0;
  const averageLength = mergeAverage(Number(previous.averageLength || 0), previousCount, lengthValue);
  const memeRate = mergeAverage(Number(previous.memeRate || 0), previousCount, memeValue);
  const emojiRate = mergeAverage(Number(previous.emojiRate || 0), previousCount, emojiValue);
  const textEmoteRate = mergeAverage(Number(previous.textEmoteRate || 0), previousCount, textEmoteValue);
  const recentTopics = [
    ...(analysis.topics || []),
    ...(previous.recentTopics || []),
  ].map((item) => String(item || '').trim()).filter(Boolean);

  const profile = {
    sampleCount,
    averageLength: Number(averageLength.toFixed(2)),
    memeRate: Number(memeRate.toFixed(3)),
    emojiRate: Number(emojiRate.toFixed(3)),
    textEmoteRate: Number(textEmoteRate.toFixed(3)),
    replyLength: classifyReplyLength(averageLength),
    humorStyle: classifyHumorStyle(memeRate),
    expressiveStyle: classifyExpressiveStyle({ emojiRate, textEmoteRate }),
    recentTopics: [...new Set(recentTopics)].slice(0, 5),
    lastUpdated: new Date(),
  };

  return {
    ...profile,
    promptSummary: summarizeGroupStylePrompt(profile),
  };
}
