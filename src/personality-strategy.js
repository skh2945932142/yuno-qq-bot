import { config } from './config.js';
import { clamp } from './utils.js';

const PHRASE_FAMILIES = Object.freeze({
  observation: ['这句重点抓得挺准。', '这个细节比结论更值得看。', '我先记住你这句话里的关键点。'],
  favoritism: ['这件事我会多看一眼。', '行，这次我站你这边。', '你把重点丢过来，我看。'],
  independence: ['这个结论我不站。', '这部分我有不同意见。', '先看证据，别急着跟着热闹跑。'],
  comfort: ['先停一下，别继续给自己加码。', '这状态先缓一缓，别硬扛。', '先处理最难的那件，其他往后放。'],
  jealousy: ['去吧，我会有点不爽，但不拦你。', '行，回来再说。', '这事我记得，别让我空等太久。'],
  closure: ['先把这一步弄完。', '结论先放这，后面再补。', '这件事别抢跑，先过当前点。'],
  meme: ['这段确实有节目效果。', '行，这个梗能接。', '这画面我已经记住了。'],
});

const SIGNATURE_MOVES = Object.freeze({
  pleased_restraint: '直接承认开心或在意，再用一句克制的判断收住；不把亲近写成客服式确认。',
  shy_deflection: '被说中时可以停顿或转开一点，但要给出明确真实回应，不固定复读“才没有”。',
  quiet_care: '先点出当前状态，再给具体关心、建议或行动，不做情绪分诊。',
  reciprocal_warmth: '直接回应对方给出的温度，可以偏爱、想念或高兴，但保持一两句。',
  playful_echo: '顺着当前措辞接梗或回声，笑点落在事情和画面，不拿人当笑点。',
  concrete_curiosity: '只在确实需要推进时问一个具体问题；没有信息价值就直接收住。',
  mild_edge: '仅在当前轮明确玩梗、轻挑战或直接邀请吐槽时，用一句针对当下内容的轻刺，随后马上给真实态度或答案。',
  observation: '只描述用户实际说出的词、语气或动作，并给出利落判断；不推断隐藏动机。',
  quiet_anchor: '先接住一个具体困难，再给能落地的下一步；不让用户做情绪分类选择题。',
  wry_observation: '用一句带戏谑的观察收住，不使用贬损称呼，不解释笑点。',
  firm_pushback: '短、清楚地反对当前说法，必要时补一个理由；不靠人身嘲弄撑气场。',
  clear_answer: '先给结论和关键细节，必要时带一句观察，但不以挖苦作开场。',
});

const LEGACY_SIGNATURE_MOVE_ALIASES = Object.freeze({
  dry_tease: 'wry_observation',
  sharp_answer: 'clear_answer',
});

const KAOMOJI_REGEX = /(?:\((?=[^)\r\n]{2,16}\))(?=[^)\r\n]*[｡・ωへ｀´▽ﾉ￣^><≧≦つっヾ；;])[^)\r\n]+\)|[=;:][\-^']?[)(DP]|[｡・ωへ｀´▽ﾉ￣]{3,})/u;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

const MEMORY_TYPES = Object.freeze(['promise', 'inside_joke', 'milestone', 'emotion', 'preference']);

function normalizeScene(event = {}) {
  return event.chatType === 'private' ? 'private' : 'group';
}

function hasRecentThread(conversationState = {}) {
  const state = conversationState || {};
  return Boolean(state.rollingSummary)
    || (state.messages?.length || 0) >= 2;
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function recentAssistantMessages(conversationState = {}, limit = 3) {
  return ((conversationState || {}).messages || [])
    .filter((item) => item?.role === 'assistant')
    .slice(-limit);
}

function hasVisibleEmoji(text) {
  const value = String(text || '');
  return EMOJI_REGEX.test(value) || KAOMOJI_REGEX.test(value);
}

function chooseWeightedMove(candidates, seed) {
  const normalized = candidates.filter((item) => item && item.key && Number(item.weight) > 0);
  const total = normalized.reduce((sum, item) => sum + Number(item.weight), 0);
  if (!total) return normalized[0]?.key || 'observation';

  let cursor = hashString(seed) % total;
  for (const candidate of normalized) {
    if (cursor < candidate.weight) return candidate.key;
    cursor -= candidate.weight;
  }
  return normalized[0].key;
}

const MICRO_STYLES = Object.freeze([
  { key: 'terse', weight: 34 },
  { key: 'normal', weight: 66 },
]);

const EXPLICIT_TEASE_NEGATION_REGEX = /(?:别|不要|不许|别再|不想|不用|停止)[^。！？!?，,]{0,8}(?:吐槽|损|怼|骂|毒舌)/;
const EXPLICIT_TEASE_REQUEST_REGEX = /(?:^|[，,。！？!?]\s*)(?:(?:来|快|给我|请|可以|能不能|敢不敢|要不|就)\s*)?(?:吐槽我(?:两句|一下)?|损我(?:两句|一下)?|怼我(?:两句|一下)?|来点毒舌(?:一点|两句)?|毒舌一点)(?:[。！？!?]|$)/;

function normalizeSignatureMoveKey(value) {
  const key = String(value || '').trim();
  return LEGACY_SIGNATURE_MOVE_ALIASES[key] || key;
}

function getEventText(event = {}) {
  return String(event.rawText || event.text || '').trim();
}

function hasExplicitTeaseRequest(event = {}) {
  const text = getEventText(event);
  if (!text || EXPLICIT_TEASE_NEGATION_REGEX.test(text)) return false;
  return EXPLICIT_TEASE_REQUEST_REGEX.test(text);
}

export function resolveMicroStyle(event = {}, extras = {}) {
  const seed = [
    'micro-style',
    event.chatId || 'chat',
    event.userId || 'user',
    event.messageId || event.timestamp || '0',
    extras.emotion || '',
  ].join('|');
  return chooseWeightedMove(MICRO_STYLES, seed) || 'normal';
}

function normalizeEventType(type) {
  const normalized = String(type || '').trim();
  return MEMORY_TYPES.includes(normalized) ? normalized : 'preference';
}

function summarizeMemoryTypes(memoryContext = {}) {
  const context = memoryContext || {};
  const counts = new Map();
  for (const item of context.eventMemories || []) {
    const type = normalizeEventType(item.eventType);
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return counts;
}

function resolveRelationshipStage({
  scene,
  relation,
  userState,
  userProfile,
  conversationState,
  messageAnalysis,
  specialUser,
}) {
  const affection = Number(relation?.affection || 0);
  const negative = messageAnalysis?.sentiment === 'negative' || messageAnalysis?.intent === 'challenge';
  const stateEmotion = String(userState?.currentEmotion || '');

  if (negative && affection < 45) {
    return 'strained';
  }
  if (['ANGRY', 'WARN'].includes(stateEmotion) && affection < 35) {
    return 'strained';
  }
  if (specialUser || userProfile?.specialBondSummary || affection >= 88) {
    return 'exclusive';
  }
  if (affection >= 65) {
    return 'trusted';
  }
  if (affection >= 30 || hasRecentThread(conversationState)) {
    return 'familiar';
  }
  return scene === 'private' ? 'familiar' : 'stranger';
}

function resolveMemoryUse({ scene, relationshipStage, memoryContext, messageAnalysis, replyPlan }) {
  const typeCounts = summarizeMemoryTypes(memoryContext);
  const availableTypes = [...typeCounts.keys()];
  const needsEmpathy = Boolean(replyPlan?.interpretation?.needsEmpathy)
    || messageAnalysis?.sentiment === 'negative'
    || messageAnalysis?.intent === 'help';

  let allowedTypes = scene === 'private'
    ? ['promise', 'milestone', 'emotion', 'preference']
    : ['inside_joke', 'preference'];

  if (relationshipStage === 'exclusive') {
    allowedTypes = scene === 'private'
      ? ['promise', 'milestone', 'emotion', 'preference', 'inside_joke']
      : ['inside_joke', 'preference', 'promise'];
  }

  const matchedTypes = allowedTypes.filter((type) => typeCounts.has(type));
  let level = 'none';
  if (matchedTypes.length > 0) {
    level = scene === 'private' || relationshipStage === 'exclusive' ? 'medium' : 'low';
  }
  if (
    relationshipStage === 'exclusive'
    && matchedTypes.some((type) => ['promise', 'milestone', 'emotion'].includes(type))
  ) {
    level = 'high';
  } else if (needsEmpathy && matchedTypes.includes('emotion')) {
    level = scene === 'private' ? 'medium' : 'low';
  }

  return {
    level,
    allowedTypes,
    availableTypes,
    matchedTypes,
    guidance: level === 'none'
      ? '这轮不主动翻旧账，只接当前输入。'
      : level === 'high'
        ? '可以低频引用共同记忆或约定，但只点到为止。'
        : '只在自然相关时轻轻带一句记忆，不复述流水账。',
  };
}

function resolvePhraseStyle({ scene, relationshipStage, emotion, messageAnalysis, replyPlan, memoryUse }) {
  const families = [];
  const subIntent = replyPlan?.interpretation?.subIntent || '';

  if (messageAnalysis?.sentiment === 'negative' || replyPlan?.interpretation?.needsEmpathy) {
    families.push('comfort');
  }
  if (/玩梗|梗/.test(subIntent) || messageAnalysis?.ruleSignals?.includes('meme-topic')) {
    families.push('meme');
  }
  if (emotion === 'JEALOUS' && messageAnalysis?.ruleSignals?.includes('jealousy-topic')) {
    families.push('jealousy');
  }
  if (relationshipStage === 'exclusive' || (relationshipStage === 'trusted' && memoryUse.level === 'high')) {
    families.push('favoritism');
  }
  families.push(scene === 'group' ? 'closure' : 'observation');

  const uniqueFamilies = [...new Set(families)];
  const candidates = uniqueFamilies
    .flatMap((family) => PHRASE_FAMILIES[family] || [])
    .slice(0, scene === 'group' ? 4 : 6);

  return {
    families: uniqueFamilies,
    candidates,
    repeatGuard: Boolean(config.chatStyleRepeatGuard),
    guidance: config.chatStyleRepeatGuard
      ? '可借用句式方向，但不要连续复用同一句开场、口癖或收尾。'
      : '句式自然即可，不要固定模板化。',
  };
}

function resolveStance({ scene, relationshipStage, emotion, messageAnalysis, replyPlan }) {
  if (emotion === 'ANGRY') return 'irritated_independent';
  if (emotion === 'SAD') return 'gloomy_reserved';
  if (messageAnalysis?.intent === 'challenge') return 'firm_boundary';
  const supportive = messageAnalysis?.intent === 'help'
    || messageAnalysis?.sentiment === 'negative'
    || replyPlan?.interpretation?.needsEmpathy;
  if (supportive) return 'supportive_protective';
  if (emotion === 'JEALOUS') return 'guarded_jealous';
  if (emotion === 'PROTECTIVE') return 'protective';
  if (emotion === 'FIXATED' || relationshipStage === 'exclusive') return scene === 'private' ? 'attached' : 'restrained_attached';
  if (/玩梗|梗/.test(replyPlan?.interpretation?.subIntent || '')) return 'playful_observant';
  return scene === 'private' ? 'independent_warm' : 'brief_independent';
}

function resolveFollowupStyle({ scene, messageAnalysis, replyPlan, conversationState }) {
  if (!replyPlan?.questionNeeded) return 'none';
  if (messageAnalysis?.intent === 'help' || messageAnalysis?.sentiment === 'negative') {
    return scene === 'private' ? 'one_question_after_support' : 'no_pressure_hint';
  }
  const recentlyAsked = recentAssistantMessages(conversationState, 2)
    .some((item) => /[？?]/.test(String(item.content || '')));
  if (recentlyAsked) return 'none';
  return scene === 'private' ? 'single_soft_question' : 'single_brief_hook';
}

function resolveSignatureMove({
  event,
  scene,
  relationshipStage,
  emotion,
  messageAnalysis,
  replyPlan,
  conversationState,
  dailyMood,
}) {
  const subIntent = String(replyPlan?.interpretation?.subIntent || '');
  const intent = String(messageAnalysis?.intent || '').toLowerCase();
  const sentiment = String(messageAnalysis?.sentiment || '').toLowerCase();
  const recentAssistant = recentAssistantMessages(conversationState, 2);
  const recentMoves = new Set(recentAssistant
    .map((item) => normalizeSignatureMoveKey(item.styleMove))
    .filter(Boolean));
  const previousEdgeScore = Number(recentAssistant.at(-1)?.edgeScore || 0);
  const recentEdgeScore = Math.max(
    0,
    ...recentAssistant.map((item) => Number(item.edgeScore || 0))
  );
  const needsSupport = intent === 'help'
    || Boolean(replyPlan?.interpretation?.needsEmpathy)
    || sentiment === 'negative';
  const isPlayful = /玩梗|梗/.test(subIntent)
    || messageAnalysis?.ruleSignals?.includes('meme-topic');
  const explicitTeaseRequest = hasExplicitTeaseRequest(event);
  const isClose = subIntent === '亲近陪伴'
    || sentiment === 'positive'
    || ['AFFECTIONATE', 'PROTECTIVE', 'FIXATED'].includes(String(emotion || '').toUpperCase())
    || ['trusted', 'exclusive'].includes(relationshipStage);
  const edgeTrigger = isPlayful
    ? 'playful-context'
    : intent === 'challenge'
      ? 'light-challenge'
      : explicitTeaseRequest
        ? 'explicit-tease-request'
        : 'none';
  // 只有当前轮主动邀请的玩梗或轻挑战可以考虑轻刺；每日心情和吃味只改变表达节奏。
  const edgeEligible = edgeTrigger !== 'none'
    && previousEdgeScore <= 0
    && recentEdgeScore <= 0
    && !needsSupport;

  let candidates;
  if (needsSupport) {
    candidates = [
      { key: 'quiet_anchor', weight: 55 },
      { key: 'quiet_care', weight: 45 },
    ];
  } else if (isPlayful) {
    candidates = [
      { key: 'playful_echo', weight: 72 },
      { key: 'wry_observation', weight: 20 },
      ...(edgeEligible ? [{ key: 'mild_edge', weight: 8 }] : []),
    ];
  } else if (intent === 'challenge') {
    candidates = [
      { key: 'firm_pushback', weight: 90 },
      ...(edgeEligible ? [{ key: 'mild_edge', weight: 10 }] : []),
    ];
  } else if (explicitTeaseRequest) {
    candidates = [
      { key: 'wry_observation', weight: 72 },
      { key: 'observation', weight: 8 },
      ...(edgeEligible ? [{ key: 'mild_edge', weight: 20 }] : []),
    ];
  } else if (subIntent === '要信息' || intent === 'query') {
    candidates = [
      { key: 'clear_answer', weight: 80 },
      { key: 'concrete_curiosity', weight: 20 },
    ];
  } else if (isClose) {
    candidates = [
      { key: 'pleased_restraint', weight: 30 },
      { key: 'shy_deflection', weight: 25 },
      { key: 'reciprocal_warmth', weight: 20 },
      { key: 'quiet_care', weight: 15 },
      { key: 'playful_echo', weight: 10 },
    ];
  } else {
    candidates = [
      { key: 'observation', weight: 30 },
      { key: 'quiet_care', weight: 20 },
      { key: 'concrete_curiosity', weight: 20 },
      { key: 'pleased_restraint', weight: 15 },
      { key: 'playful_echo', weight: 10 },
      { key: 'reciprocal_warmth', weight: 5 },
    ];
  }

  if (!replyPlan?.questionNeeded) {
    candidates = candidates.filter((item) => item.key !== 'concrete_curiosity');
  }
  if (dailyMood?.key === 'SHY') candidates.push({ key: 'shy_deflection', weight: 18 });
  if (dailyMood?.key === 'PROTECTIVE') candidates.push({ key: 'quiet_care', weight: 18 });
  if (dailyMood?.key === 'PLAYFUL' || dailyMood?.key === 'BRIGHT') {
    candidates.push({ key: 'playful_echo', weight: 14 });
  }
  if (['DISTANT', 'GLOOMY'].includes(dailyMood?.key)) {
    candidates.push({ key: 'pleased_restraint', weight: 14 });
  }

  const nonRepeated = candidates.filter((item) => !recentMoves.has(item.key));
  if (nonRepeated.length > 0) candidates = nonRepeated;

  const seed = [
    event?.platform,
    event?.chatId,
    event?.userId,
    event?.messageId || event?.rawText || event?.text,
    dailyMood?.dateKey,
    scene,
  ].join(':');
  const key = chooseWeightedMove(candidates, seed);

  return {
    key,
    guidance: SIGNATURE_MOVES[key] || SIGNATURE_MOVES.observation,
    edgeAllowed: key === 'mild_edge',
    edgeEligible,
    edgeTrigger,
    previousEdgeScore,
  };
}

function buildPromptHints({
  scene,
  relationshipStage,
  stance,
  memoryUse,
  followupStyle,
  emotion,
  phraseStyle,
  dailyMood,
  addressing,
  emojiPolicy,
}) {
  const hints = [];

  if (scene === 'group') {
    hints.push('群聊通常一句解决：接话快、判断清楚、保留群内节奏，不展开私人记忆或暧昧长文，也不要把人当笑点。');
  } else {
    hints.push('私聊通常一到两句，可以直接表达偏爱、开心、想念、吃味和不爽，但观察和判断一样利落。');
  }

  hints.push('顺序不固定：接话、观察、判断、答案哪个先都行；不要靠固定口头禅或同一种反差撑人设。');
  hints.push('默认不使用轻蔑称呼或贬损外号；只有本轮明确允许时，最多一句针对当前内容的轻刺，随后马上回到态度或答案。');
  hints.push('QQ 网感可以来自梗、重复字、emoji 和不完整句；按语境使用，不固定复读。');
  hints.push('观察只基于当前说法和已知事实，不把猜测写成“你每次、你就是、你只是想”。');
  hints.push('只有确实能推进时才追问一个具体问题；不使用确认回执、心理咨询流程或服务式收尾。');

  if (stance === 'supportive_protective') {
    hints.push('先接住当前状态，再给具体建议、行动或直接帮助；不要固定写成“先损后暖”。');
  } else if (stance === 'firm_boundary') {
    hints.push('这轮直接说哪里不认同，必要时补一个理由；只针对当前说法，不脏骂、不威胁、不连续追问。');
  } else if (stance === 'guarded_jealous') {
    hints.push('直接说不爽或吃味，保持一两句，不攻击第三方，也不限制社交。');
  } else if (stance === 'playful_observant') {
    hints.push('直接接梗或做一句观察，笑点说完就停，不解释段子。');
  }

  if (relationshipStage === 'exclusive') {
    hints.push(scene === 'private'
      ? '特殊关系可以有偏爱和共同记忆，但不要现实控制。'
      : '特殊关系在群里也要克制偏爱，不刷屏。');
  }

  if (memoryUse.level !== 'none') {
    hints.push(memoryUse.guidance);
  }

  if (followupStyle !== 'none') {
    hints.push('这轮最多追问一个具体问题，问题前先给态度或答案。');
  } else {
    hints.push('这一轮不需要追问，说完自然收住。');
  }

  if (emotion === 'ANGRY' || stance === 'irritated_independent') {
    hints.push('真正生气时变短、变冷，直接说不喜欢或不同意；只否定当前说法，不升级成人格攻击、脏骂或威胁。');
  } else if (emotion === 'SAD') {
    hints.push('低落时先给明确关心、建议或行动，不把关心写成打趣后的补偿。');
  }

  if (dailyMood?.promptStyle) {
    hints.push(`今日表达方式：${dailyMood.promptStyle}`);
  }

  if (addressing?.allowed && addressing.value) {
    hints.push(`只有情绪需要强调时才可称呼对方“${addressing.value}”，本轮最多一次。`);
  } else {
    hints.push('不用甜腻昵称或损友外号；称呼只在确实需要强调关系时才出现。');
  }

  hints.push(emojiPolicy?.allowed
    ? '本轮可以使用一个明显的 emoji、颜文字或重复字来增加网感。'
    : '最近已用过表情，本轮不要再放 emoji 或颜文字。');

  if (phraseStyle.repeatGuard) {
    hints.push('避免连续复用同一句开场、口癖或收尾。');
  }

  return hints;
}

function resolveAddressingPolicy(userProfile, conversationState) {
  const names = [...new Set([
    userProfile?.preferredName,
    ...(userProfile?.specialNicknames || []),
  ].map((item) => String(item || '').trim()).filter(Boolean))];
  const value = names[0] || '';
  const recentlyUsed = value
    ? recentAssistantMessages(conversationState, 3).some((item) => String(item.content || '').includes(value))
    : false;

  return {
    value,
    allowed: Boolean(value) && !recentlyUsed,
    recentlyUsed,
  };
}

function resolveEmojiPolicy(scene, conversationState, event) {
  const recent = recentAssistantMessages(conversationState, 1);
  const recentlyUsed = recent.some((item) => hasVisibleEmoji(item.content));
  const allowed = !recentlyUsed;
  return {
    allowed,
    budget: allowed ? 1 : 0,
    style: 'internet',
    recentlyUsed,
    scene,
  };
}

export function resolvePersonalityStrategy({
  event = {},
  relation = null,
  userState = null,
  userProfile = null,
  conversationState = null,
  memoryContext = null,
  messageAnalysis = {},
  emotionResult = {},
  replyPlan = null,
  specialUser = null,
} = {}) {
  const scene = normalizeScene(event);
  const emotion = String(emotionResult?.emotion || userState?.currentEmotion || 'CALM');
  const dailyMood = emotionResult?.dailyMood || null;
  const relationshipStage = resolveRelationshipStage({
    scene,
    relation,
    userState,
    userProfile,
    conversationState,
    messageAnalysis,
    specialUser,
  });
  const memoryUse = resolveMemoryUse({
    scene,
    relationshipStage,
    memoryContext,
    messageAnalysis,
    replyPlan,
  });
  const stance = resolveStance({
    scene,
    relationshipStage,
    emotion,
    messageAnalysis,
    replyPlan,
  });
  const followupStyle = resolveFollowupStyle({ scene, messageAnalysis, replyPlan, conversationState });
  const signatureMove = resolveSignatureMove({
    event,
    scene,
    relationshipStage,
    emotion,
    messageAnalysis,
    replyPlan,
    conversationState,
    dailyMood,
  });
  const warmthScore = clamp(
    Number(relation?.affection || 30) / 100
      + (scene === 'private' ? 0.12 : 0)
      + (['AFFECTIONATE', 'PROTECTIVE', 'FIXATED'].includes(emotion) ? 0.18 : 0)
      - (relationshipStage === 'strained' ? 0.22 : 0),
    0,
    1
  );
  const warmth = warmthScore >= 0.72 ? 'high' : warmthScore >= 0.42 ? 'medium' : 'low';
  const jealousyTriggered = messageAnalysis?.ruleSignals?.includes('jealousy-topic');
  const possessiveness = emotion === 'JEALOUS' && jealousyTriggered
    ? scene === 'private' ? 'medium' : 'low'
    : relationshipStage === 'exclusive' ? 'low' : 'none';
  const humor = /玩梗|梗/.test(replyPlan?.interpretation?.subIntent || '')
    || messageAnalysis?.ruleSignals?.includes('meme-topic')
    ? 'meme'
    : userProfile?.humorStyle === 'meme-heavy'
      ? 'light'
      : 'none';
  const phraseStyle = resolvePhraseStyle({
    scene,
    relationshipStage,
    emotion,
    messageAnalysis,
    replyPlan,
    memoryUse,
  });
  const addressing = resolveAddressingPolicy(userProfile, conversationState);
  const emojiPolicy = resolveEmojiPolicy(scene, conversationState, event);

  const forbiddenMoves = [
    '不要输出系统说明、规则说明、角色标签或 <think>/<thinking>。',
    '不要现实威胁、跟踪、控制对方或暗示线下伤害。',
    '默认不使用轻蔑称呼或贬损性外号；只有明确玩梗、轻挑战或用户直接邀请时，才允许一句针对当前内容的轻刺。',
    '不要揣测动机或使用“你每次、你就是、你只是想、被我说中了、找借口、蒙混过关”。',
    '每条优先传递一个观察、判断、答案或具体关心；不把找攻击点当作固定步骤，不连续反问或围着同一弱点反复羞辱。',
    '若本轮允许轻刺，也只针对这件事或这句话，不否定对方整个人的能力和价值。',
    '低落时先给明确关心、建议或行动，不套心理咨询模板，也不拿打趣当关心的前置条件。',
    scene === 'group'
      ? '群聊不要公开展开私人记忆、暧昧长文或连续刷屏。'
      : '私聊也不要把偏爱写成强迫或过度占有。',
  ];
  const microStyle = resolveMicroStyle(event, { emotion });

  return {
    scene,
    relationshipStage,
    microStyle,
    stance,
    warmth,
    possessiveness,
    humor,
    memoryUse,
    followupStyle,
    signatureMove,
    edgeEligible: signatureMove.edgeEligible,
    edgeTrigger: signatureMove.edgeTrigger,
    phraseStyle,
    addressing,
    emojiPolicy,
    emojiBudget: emojiPolicy.budget,
    emojiStyle: emojiPolicy.style,
    forbiddenMoves,
    promptHints: buildPromptHints({
      scene,
      relationshipStage,
      stance,
      memoryUse,
      followupStyle,
      emotion,
      phraseStyle,
      dailyMood,
      addressing,
      emojiPolicy,
    }),
  };
}
