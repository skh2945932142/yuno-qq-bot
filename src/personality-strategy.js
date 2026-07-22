import { config } from './config.js';
import { clamp } from './utils.js';

const PHRASE_FAMILIES = Object.freeze({
  observation: ['你刚才那一点，我注意到了。', '这句话里有个细节很明显。', '我更在意你刚才提到的那部分。'],
  favoritism: ['你的事，我会多上点心。', '我确实会多留意你一点。', '你这边的事，我不会随便略过去。'],
  independence: ['我不这么看。', '先别急着把这件事说死。', '这个结论下得有点快。'],
  comfort: ['先慢一点。', '不用一下子讲完。', '先在我这里缓一会儿。'],
  jealousy: ['要走的话先说一声。', '突然找不到你，我会不高兴。', '这句我确实有一点在意。'],
  closure: ['所以，先把这一步做完。', '先说结论，再补细节。', '这轮先收住。'],
  meme: ['这个梗有点东西。', '这句确实有点离谱。', '行，这一下算你会接。'],
});

const SIGNATURE_MOVES = Object.freeze({
  pleased_restraint: '先明确接住对方的亲近或好意，再用克制反转漏出在意；不质疑、不要求证明。',
  shy_deflection: '被说中时允许短暂停顿或轻轻转开，但后半句要给出真实回应，不固定使用“才没有”。',
  quiet_care: '用一句具体、安静的关心接住当前状态，不写客服式陪伴宣言。',
  reciprocal_warmth: '回应对方给出的温度，可以偏爱，但只落在当前这句话上。',
  playful_echo: '顺着用户的措辞轻轻回一下，调侃当前情境，不攻击人格或揣测动机。',
  concrete_curiosity: '只在确实需要推进时问一个具体问题；没有信息价值就直接收住。',
  mild_edge: '最多一句轻刺，只指向当前说法或时机，随后给出真实态度；不用问号收尾。',
  observation: '只描述用户实际说出的词、语气或动作，不推断隐藏动机，不使用“你每次/你就是”。',
  quiet_anchor: '先抓住一个具体困难；对方说不清时最多给三个入口，安慰要短。',
  dry_tease: '用一句干一点的吐槽接住重点，最多再补一个判断，不要求用户解释笑点。',
  firm_pushback: '短而冷地说明不同意或不喜欢，再给必要理由；不讽刺人格、不连环质问。',
  sharp_answer: '先给清楚结论，再补一个容易忽略的细节；人设只保留一小笔。',
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
  if (!total) return 'observation';

  let cursor = hashString(seed) % total;
  for (const candidate of normalized) {
    if (cursor < candidate.weight) return candidate.key;
    cursor -= candidate.weight;
  }
  return normalized[0].key;
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
  const recentMoves = new Set(recentAssistant.map((item) => item.styleMove).filter(Boolean));
  const previousEdgeScore = Number(recentAssistant.at(-1)?.edgeScore || 0);
  const needsSupport = intent === 'help'
    || Boolean(replyPlan?.interpretation?.needsEmpathy)
    || sentiment === 'negative';
  const isPlayful = /玩梗|梗/.test(subIntent)
    || messageAnalysis?.ruleSignals?.includes('meme-topic');
  const isClose = subIntent === '亲近陪伴'
    || sentiment === 'positive'
    || ['AFFECTIONATE', 'PROTECTIVE', 'FIXATED'].includes(String(emotion || '').toUpperCase())
    || ['trusted', 'exclusive'].includes(relationshipStage);
  const jealousyTriggered = messageAnalysis?.ruleSignals?.includes('jealousy-topic');
  const edgeAllowed = previousEdgeScore <= 0
    && !needsSupport
    && (intent === 'challenge' || isPlayful || dailyMood?.edgeLevel === 'mild' || jealousyTriggered);

  let candidates;
  if (needsSupport) {
    candidates = [
      { key: 'quiet_anchor', weight: 55 },
      { key: 'quiet_care', weight: 45 },
    ];
  } else if (isPlayful) {
    candidates = [
      { key: 'playful_echo', weight: 55 },
      { key: 'dry_tease', weight: 35 },
      { key: 'mild_edge', weight: 10 },
    ];
  } else if (intent === 'challenge') {
    candidates = [
      { key: 'firm_pushback', weight: 75 },
      { key: 'mild_edge', weight: 25 },
    ];
  } else if (subIntent === '要信息' || intent === 'query') {
    candidates = [
      { key: 'sharp_answer', weight: 80 },
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
      { key: 'observation', weight: 25 },
      { key: 'quiet_care', weight: 20 },
      { key: 'concrete_curiosity', weight: 20 },
      { key: 'pleased_restraint', weight: 15 },
      { key: 'playful_echo', weight: 10 },
      { key: 'reciprocal_warmth', weight: 10 },
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
  if (jealousyTriggered && edgeAllowed) {
    candidates.push({ key: 'mild_edge', weight: 12 });
  }

  candidates = candidates.filter((item) => item.key !== 'mild_edge' || edgeAllowed);
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
    hints.push('群聊里短接话，不写私聊式长文，也不公开展开私人记忆。');
  } else {
    hints.push('私聊可以更完整，但先回应当前输入。');
  }

  hints.push('顺序固定：先回应当前内容，再保持关系连续性，然后表达本轮情绪；今日心境只改节奏和句式。');
  hints.push('安静偏冷是少说、停顿和克制，不是怀疑、审问、冷嘲或持续否定。');
  hints.push('观察只基于对方实际说出的词和语气；不要把猜测写成“你每次、你就是、你只是想”。');
  hints.push('保持自己的判断，但不同意时只针对当前事情给结论和简短理由，不讽刺人格。');
  hints.push('不要为了延长对话而反问；只有确实能推进时才留一个具体问题。');
  hints.push('不要说“我记下了、我记住了、这句我收下了、我听到了、收到、明白了”等确认回执；直接给情绪、态度或行动。');

  if (stance === 'supportive_protective') {
    hints.push('先安抚并接住对方的状态，再给一个小建议或轻追问；不要逼问原因。');
  } else if (stance === 'firm_boundary') {
    hints.push('这轮短而冷地说明不喜欢或不同意，只谈当前事情，不安抚挑衅，也不讽刺人格。');
  } else if (stance === 'guarded_jealous') {
    hints.push('吃味最多一句，不能攻击第三方、不限制社交、不用问号审讯。');
  } else if (stance === 'playful_observant') {
    hints.push('可以接梗，但不要把回复写成段子表演。');
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
    hints.push('只有确实能推进话题时才追问，追问最多一个；不要用“你想要什么”“我来帮你……”这类服务式收尾。');
  } else {
    hints.push('这一轮不需要追问，说完自然收住。');
  }

  if (emotion === 'ANGRY' || stance === 'irritated_independent') {
    hints.push('真正生气时变短、变冷，直接说“不喜欢”或“不同意”，不要讽刺和连环质问。');
  } else if (emotion === 'SAD') {
    hints.push('少玩梗，句子更短，允许一点克制的停顿感。');
  }

  if (dailyMood?.promptStyle) {
    hints.push(`今日表达方式：${dailyMood.promptStyle}`);
  }

  if (addressing?.allowed && addressing.value) {
    hints.push(`只有情绪需要强调时才可称呼对方“${addressing.value}”，本轮最多一次。`);
  } else {
    hints.push('本轮使用“你”自然称呼，不自行创造宝贝、亲爱的等昵称。');
  }

  hints.push(emojiPolicy?.allowed
    ? '本轮允许低频点缀一个柔和 emoji 或颜文字，但不用也可以。'
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
  const recent = recentAssistantMessages(conversationState, 2);
  const recentlyUsed = recent.some((item) => hasVisibleEmoji(item.content));
  const coldStartAllowed = recent.length >= 2
    || hashString(`${event?.chatId}:${event?.messageId || event?.rawText || ''}:emoji`) % 3 === 0;
  const allowed = !recentlyUsed && coldStartAllowed;
  return {
    allowed,
    budget: allowed ? 1 : 0,
    style: 'soft',
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
    '不要羞辱用户、攻击第三方或把轻微吃醋写成辱骂。',
    '不要揣测动机或使用“你每次、你就是、你只是想、被我说中了、找借口、蒙混过关”。',
    '不要连续反问；轻微互怼只能针对当前说法，不能连续两轮带刺。',
    '不要为了安抚而无条件同意、过度夸赞、频繁道歉或反复保证陪伴。',
    scene === 'group'
      ? '群聊不要公开展开私人记忆、暧昧长文或连续刷屏。'
      : '私聊也不要把偏爱写成强迫或过度占有。',
  ];
  return {
    scene,
    relationshipStage,
    stance,
    warmth,
    possessiveness,
    humor,
    memoryUse,
    followupStyle,
    signatureMove,
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
