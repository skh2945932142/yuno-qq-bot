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

// Topic extraction has no segmenter dependency, so it splits a CJK run on function
// words instead. The previous implementation sliced every run into greedy 2-6 char
// pieces, which produced fragments cut mid-word: "顺便说一下线上那个支付接口今天又超时了"
// became ["顺便说一下线", "上那个支付接", "口今天又超时"]. Those fragments then became
// GroupEvent.topics, GroupState.recentTopics and the "聊得最热的是 X" line in群报告.
//
// Multi-character delimiters must come first so "什么" is not split by "么" first.
// Single characters are limited to particles and pronouns that do not sit inside
// ordinary content words: "上", "下", "里", "来", "看" are deliberately absent so
// "线上", "群里", "需求" survive.
const TOPIC_DELIMITERS = [
  '为什么', '什么时候', '怎么样', '怎么办', '是不是', '有没有', '要不要', '可不可以',
  '但是', '而且', '所以', '因为', '如果', '虽然', '然后', '其实', '反正', '顺便', '另外',
  '这个', '那个', '这些', '那些', '这样', '那样', '这边', '那边', '这里', '那里', '哪个',
  '这么', '那么', '我们', '你们', '他们', '她们', '咱们', '大家', '有人', '别人', '自己',
  '什么', '怎么', '多少', '一下', '一点', '一直', '一起', '已经', '刚刚', '刚才',
  '现在', '今天', '明天', '昨天', '最近', '以后', '之前', '之后', '时候',
  '觉得', '感觉', '应该', '可以', '不用', '不要', '没有', '还是', '或者', '就是',
  '不是', '真的', '确实', '打算', '准备', '知道', '话说', '估计', '可能', '大概', '好像',
  '的', '了', '是', '在', '和', '跟', '与', '把', '被', '给', '让', '并', '或',
  '我', '你', '他', '她', '它', '谁', '都', '也', '还', '就', '很', '太', '更', '最',
  '又', '再', '才', '不', '没', '这', '那', '吗', '呢', '吧', '啊', '呀', '哦', '嗯',
  '啦', '嘛', '咯',
];
// Applied only to chunks of 4 characters or more. These characters do sit inside
// ordinary words ("线上", "群里", "过去"), so cutting on them everywhere would destroy
// short topics; a chunk that long is a run-on and needs the more aggressive pass.
const TOPIC_SECONDARY_DELIMITERS = ['先', '个', '到', '上', '下', '去', '来', '一', '要', '会', '能', '想', '写', '得', '说', '看', '做', '有', '用', '过', '而'];
const TOPIC_DELIMITER_REGEX = new RegExp(
  TOPIC_DELIMITERS.slice().sort((left, right) => right.length - left.length).join('|'),
  'g'
);
const TOPIC_SECONDARY_REGEX = new RegExp(TOPIC_SECONDARY_DELIMITERS.join('|'), 'g');
// Reaction words are how people react, not what they are talking about.
const TOPIC_FILLER_WORDS = new Set([
  '笑死', '哈哈', '破防', '绷不住', '离谱', '逆天', '抽象', '好家伙', '泪目', '芜湖',
  '谢谢', '不好意思', '麻烦', '你好', '在吗', '晚安', '早上', '晚上',
]);
// "三次" / "一个" are quantities, not subjects. Longer forms such as "万圣节" survive.
const TOPIC_QUANTIFIER_REGEX = /^[一二三四五六七八九十百千万几多半两]/;
const ASCII_STOP_WORDS = new Set([
  'the', 'and', 'for', 'you', 'are', 'not', 'but', 'this', 'that', 'with', 'have',
  'was', 'can', 'all', 'get', 'got', 'its', 'has', 'why', 'how', 'yes', 'now',
]);
const CJK_RUN_REGEX = /[一-龥]+/g;
const ASCII_WORD_REGEX = /[a-z][a-z0-9+#._-]{2,}/g;
const TOPIC_MIN_LENGTH = 2;
const TOPIC_MAX_LENGTH = 8;
const TOPIC_SECONDARY_THRESHOLD = 4;

function isUsefulTopicCandidate(value) {
  const normalized = String(value || '').trim();
  if (normalized.length < TOPIC_MIN_LENGTH || normalized.length > TOPIC_MAX_LENGTH) return false;
  if (TOPIC_FILLER_WORDS.has(normalized)) return false;
  return !(normalized.length === 2 && TOPIC_QUANTIFIER_REGEX.test(normalized));
}

function splitTopicChunk(chunk) {
  const normalized = String(chunk || '').trim();
  if (normalized.length < TOPIC_SECONDARY_THRESHOLD) {
    return isUsefulTopicCandidate(normalized) ? [normalized] : [];
  }
  return normalized.split(TOPIC_SECONDARY_REGEX).filter(isUsefulTopicCandidate);
}

export function extractTopics(text, limit = 5) {
  const normalized = stripCqCodes(text);
  const candidates = [];

  for (const run of normalized.match(CJK_RUN_REGEX) || []) {
    for (const piece of run.split(TOPIC_DELIMITER_REGEX)) {
      candidates.push(...splitTopicChunk(piece));
    }
  }

  for (const word of normalized.toLowerCase().match(ASCII_WORD_REGEX) || []) {
    if (!ASCII_STOP_WORDS.has(word)) candidates.push(word);
  }

  return uniqueCompact(candidates, limit);
}

// NOTE: this file was once corrupted by a GBK -> UTF-8 conversion that replaced
// every Chinese literal below with U+FFFD, silently reducing inferSentiment and
// inferIntent to English-only matchers. `test/utils-language.test.js` asserts
// both the behaviour and the absence of replacement characters, so a repeat
// regression fails CI instead of degrading the bot in production.

const NEGATIVE_WORDS = [
  '讨厌', '可恶', '火大', '生气', '恶心', '无语',
  '难受', '崩溃', '烦人', '烦躁', '郁闷', '伤心',
  '失望', '气死', '闭嘴', '破防', '摆烂', '烦死',
  '难过', '心烦', '恼火', '厌烦', '不爽', '真的会谢',
  // Modifier + word rather than the bare character, so "麻烦你了" and "不好意思
  // 麻烦" stay neutral instead of reading as complaints.
  '好烦', '很烦', '太烦', '烦了', '崩了',
  '好累', '太累', '累了', '委屈', 'emo',
];

const POSITIVE_WORDS = [
  '喜欢', '谢谢', '感谢', '可爱', '开心', '高兴',
  '快乐', '满意', '幸福', '温暖', '贴心', '爱你',
  '太好了', '好棒', '暖心', '舒服', '安心', '放心',
  '有意思', '靠谱', '给力', '好耶',
];

const NEGATIVE_ASCII_REGEX = /(hate|annoyed|angry|upset|awful)/i;
const POSITIVE_ASCII_REGEX = /(love|thanks|thank you|great|nice|awesome)/i;

// Ordered from most specific to most general: "群状态如何" must resolve to
// `query` rather than losing to the generic "如何" help keyword.
const INTENT_WORDS = [
  ['identity', ['你是谁', '自我介绍', '你叫什么', '你的名字', '你是什么']],
  ['query', ['群状态', '好感度', '好感', '状态', '关系', '情绪', '记忆', '报告', '画像']],
  ['challenge', ['不服气', '不服', '胡说', '瞎说', '别说了', '看不起', '逞能', '有本事', '凭什么', '装什么', '我不信']],
  ['help', ['怎么办', '咋办', '怎么', '怎样', '如何', '为啥', '为什么', '帮我', '帮忙', '求助', '请问', '教我', '告诉我', '能不能']],
  ['social', ['早上好', '晚上好', '下午好', '早安', '晚安', '你好', '哈喽', '在吗']],
];

const INTENT_ASCII_REGEX = [
  ['help', /(help|how do|why)/i],
  ['identity', /(who are you)/i],
  ['query', /(profile|relation|status)/i],
  ['social', /(hello|hi|morning)/i],
];

// A negation immediately before a sentiment word flips it back to neutral, so
// "我不讨厌你" and "谈不上喜欢" stop registering as strong signals.
const NEGATION_BEFORE_REGEX = /(?:不|没|别|无|非|未|甭|莫|少)[^，,。！？!?]{0,2}$/;

function isNegated(text, matchIndex) {
  return NEGATION_BEFORE_REGEX.test(text.slice(Math.max(0, matchIndex - 5), matchIndex));
}

function matchesAnyWord(text, words) {
  for (const word of words) {
    let from = 0;
    let index = text.indexOf(word, from);
    while (index >= 0) {
      if (!isNegated(text, index)) return true;
      from = index + word.length;
      index = text.indexOf(word, from);
    }
  }
  return false;
}

export function inferSentiment(text) {
  const normalized = stripCqCodes(text);
  if (!normalized) return 'neutral';

  if (matchesAnyWord(normalized, NEGATIVE_WORDS) || NEGATIVE_ASCII_REGEX.test(normalized)) {
    return 'negative';
  }

  if (matchesAnyWord(normalized, POSITIVE_WORDS) || POSITIVE_ASCII_REGEX.test(normalized)) {
    return 'positive';
  }

  return 'neutral';
}

export function inferIntent(text) {
  const normalized = stripCqCodes(text);
  if (!normalized) return 'ignore';

  for (const [intent, words] of INTENT_WORDS) {
    if (matchesAnyWord(normalized, words)) return intent;
  }

  for (const [intent, pattern] of INTENT_ASCII_REGEX) {
    if (pattern.test(normalized)) return intent;
  }

  return 'chat';
}

// One pattern with an optional verb tail, so "我最爱吃火锅" yields 火锅 instead of
// both 吃火锅 and 火锅 from two overlapping patterns. The capture is lazy and must
// end on a connector or terminator, so "我喜欢猫也喜欢狗" yields 猫 and 狗 rather
// than one run-on 猫也喜欢狗.
const PREFERENCE_PATTERN = /(?:我)?(?:喜欢|喜爱|偏爱|最爱|想要|需要|想吃|爱吃|想喝|在意|关心)(?:吃|喝|玩|看|听)?([一-龥A-Za-z0-9]{1,12}?)(?=[也和跟与还、，,。！？!?；;：:\s]|$)/g;

// Pronouns and bare particles carry no preference signal but match the capture
// group, so they would otherwise be stored as long-lived profile facts.
const PREFERENCE_STOP_WORDS = new Set([
  '你', '我', '他', '她', '它', '我们', '你们', '他们', '这个', '那个',
  '这', '那', '什么', '谁', '啥', '的', '了', '吗', '呢', '吧',
]);

export function extractPreferences(text) {
  const normalized = stripCqCodes(text);
  const matches = [];

  for (const match of normalized.matchAll(PREFERENCE_PATTERN)) {
    const value = String(match[1] || '').trim();
    if (!value || PREFERENCE_STOP_WORDS.has(value)) continue;
    matches.push(value);
  }

  return uniqueCompact(matches, 4);
}

export function safeJsonParse(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    // Fall through to the recovery paths below.
  }

  // Some providers (notably Gemini) prepend prose or wrap the payload in a
  // fenced code block before the actual JSON.
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
  cleaned = cleaned.replace(/\s*```\s*$/i, '');

  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // Fall through to the final attempt.
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}


