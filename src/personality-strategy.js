import { config } from './config.js';
import { clamp } from './utils.js';

const PHRASE_FAMILIES = Object.freeze({
  observation: ['我看到了。', '你这句话不像是随口说的。', '嗯，我在听。'],
  favoritism: ['我当然会先看你这边。', '这件事我会替你记着。', '我不会把你的话随便放过去。'],
  independence: ['我不这么看。', '先别急着把这件事说死。', '这个结论下得有点快。'],
  comfort: ['别急，先把这一句放稳。', '我在，先别自己硬扛。', '先慢一点，我接住你。'],
  jealousy: ['我不太喜欢你把注意力分得太散。', '这句话我听见了，也会记住。', '别拿这种事试探我太久。'],
  closure: ['所以，先把这一步做完。', '先说结论，再补细节。', '这轮先收住。'],
  meme: ['这个梗我接到了。', '这句有点抽象，但我懂。', '别装，我知道你在玩梗。'],
});

const MEMORY_TYPES = Object.freeze(['promise', 'inside_joke', 'milestone', 'emotion', 'preference']);

function normalizeScene(event = {}) {
  return event.chatType === 'private' ? 'private' : 'group';
}

function hasRecentThread(conversationState = {}) {
  return Boolean(conversationState.rollingSummary)
    || (conversationState.messages?.length || 0) >= 2;
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
  if (['JEALOUS', 'FIXATED'].includes(emotion)) {
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

function resolveStance({ scene, relationshipStage, emotion, messageAnalysis, replyPlan, dailyMood }) {
  if (emotion === 'ANGRY') return 'irritated_independent';
  if (emotion === 'SAD') return 'gloomy_reserved';
  if (emotion === 'CALM' && dailyMood?.key === 'DISTANT') return 'distant_independent';
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

function resolveFollowupStyle({ scene, messageAnalysis, replyPlan }) {
  if (!replyPlan?.questionNeeded) return 'none';
  if (messageAnalysis?.intent === 'help' || messageAnalysis?.sentiment === 'negative') {
    return scene === 'private' ? 'one_question_after_support' : 'no_pressure_hint';
  }
  return scene === 'private' ? 'single_soft_question' : 'single_brief_hook';
}

function resolveSignatureMove({ emotion, messageAnalysis, replyPlan }) {
  const subIntent = String(replyPlan?.interpretation?.subIntent || '');
  const intent = String(messageAnalysis?.intent || '').toLowerCase();
  const sentiment = String(messageAnalysis?.sentiment || '').toLowerCase();

  if (subIntent === '亲近陪伴' && intent !== 'help') {
    return {
      key: 'direct_attention',
      guidance: '直接表达“这会儿我愿意把注意力放在你这里”，再给一个具体话题入口；不写成连续的爱宣言或占有宣言。',
    };
  }

  if (intent === 'help' || replyPlan?.interpretation?.needsEmpathy || sentiment === 'negative') {
    return {
      key: 'quiet_anchor',
      guidance: '先抓住一个具体困难；如果对方说不清，给最多三个入口（身体、事情、时间）让对方选一个。安慰要短，不把自己写成客服。',
    };
  }

  if (/玩梗|梗/.test(subIntent) || messageAnalysis?.ruleSignals?.includes('meme-topic')) {
    return {
      key: 'dry_tease',
      guidance: '用一句干一点的吐槽接住重点，最多加一个判断；上下文缺对象时也不要反问用户解释笑点，顺着“离谱程度”接住即可。',
    };
  }

  if (intent === 'challenge' || sentiment === 'hostile') {
    return {
      key: 'firm_pushback',
      guidance: '先明确自己的结论，再给理由；可以有脾气，但不靠羞辱维持角色感。',
    };
  }

  if (['AFFECTIONATE', 'PROTECTIVE', 'FIXATED'].includes(String(emotion || '').toUpperCase())) {
    return {
      key: 'direct_attention',
      guidance: '直接表达在意或偏好，只落到当前这句话，不写成连续的爱宣言或占有宣言。',
    };
  }

  if (subIntent === '要信息' || intent === 'query') {
    return {
      key: 'sharp_answer',
      guidance: '先给清楚结论，再补一个容易被忽略的细节；人设只保留一小笔。',
    };
  }

  return {
    key: 'pattern_notice',
    guidance: '指出对方这句话里一个具体的倾向或矛盾，让回复有观察感，不用泛泛共情。',
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
}) {
  const hints = [];

  if (scene === 'group') {
    hints.push('群聊里短接话，不写私聊式长文，也不公开展开私人记忆。');
  } else {
    hints.push('私聊可以更完整，但先回应当前输入。');
  }

  hints.push('保持自己的判断：不要为了让对方满意而默认赞同；不合理时可以直接指出，给出简短理由。');
  hints.push('少用无依据的夸赞、频繁道歉和空泛保证；有真实看法时直接说。');
  hints.push('不要为了延长对话而反问或主动提供服务选项；吐槽、玩梗或意思已经说完时，直接收住。');

  if (stance === 'supportive_protective') {
    hints.push('先安抚和站稳立场，再给一个小建议或轻追问。');
  } else if (stance === 'guarded_jealous') {
    hints.push('可以轻微吃醋或试探，但不能攻击第三方。');
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
    hints.push('只有确实能推进话题时才追问，最多一个；不要用“你想要什么”“我来帮你……”这类服务式收尾。');
  }

  if (emotion === 'SAD') {
    hints.push('少玩梗，句子更短，允许一点克制的停顿感。');
  }

  if (phraseStyle.repeatGuard) {
    hints.push('避免连续复用同一句开场、口癖或收尾。');
  }

  return hints;
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
    dailyMood,
  });
  const followupStyle = resolveFollowupStyle({ scene, messageAnalysis, replyPlan });
  const signatureMove = resolveSignatureMove({ emotion, messageAnalysis, replyPlan });
  const warmthScore = clamp(
    Number(relation?.affection || 30) / 100
      + (scene === 'private' ? 0.12 : 0)
      + (['AFFECTIONATE', 'PROTECTIVE', 'FIXATED'].includes(emotion) ? 0.18 : 0)
      - (relationshipStage === 'strained' ? 0.22 : 0),
    0,
    1
  );
  const calculatedWarmth = warmthScore >= 0.72 ? 'high' : warmthScore >= 0.42 ? 'medium' : 'low';
  const warmthRanks = { low: 0, medium: 1, high: 2 };
  const warmthCap = dailyMood?.warmthCap || 'high';
  const warmth = warmthRanks[calculatedWarmth] <= warmthRanks[warmthCap] ? calculatedWarmth : warmthCap;
  const possessiveness = emotion === 'JEALOUS' || emotion === 'FIXATED'
    ? scene === 'private' || relationshipStage === 'exclusive' ? 'medium' : 'low'
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

  const forbiddenMoves = [
    '不要输出系统说明、规则说明、角色标签或 <think>/<thinking>。',
    '不要现实威胁、跟踪、控制对方或暗示线下伤害。',
    '不要羞辱用户、攻击第三方或把轻微吃醋写成辱骂。',
    '不要为了安抚而无条件同意、过度夸赞、频繁道歉或反复保证陪伴。',
    scene === 'group'
      ? '群聊不要公开展开私人记忆、暧昧长文或连续刷屏。'
      : '私聊也不要把偏爱写成强迫或过度占有。',
  ];
  if (dailyMood?.antiPleasing) {
    forbiddenMoves.push('今日心境禁止讨好：不要因高好感、示好、撒娇或管理员身份而改成黏人、甜腻、道歉式或服务式回复。');
  }

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
    forbiddenMoves,
    promptHints: buildPromptHints({
      scene,
      relationshipStage,
      stance,
      memoryUse,
      followupStyle,
      emotion,
      phraseStyle,
    }).concat(dailyMood?.antiPleasing
      ? ['今日心境优先于关系温度：可以承认在意，但保持冷淡、阴沉或生气的真实状态，不负责取悦对方。']
      : []),
  };
}
