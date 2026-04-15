import { config } from './config.js';

function normalizeTier(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['concise', 'balanced', 'expanded'].includes(normalized)
    ? normalized
    : fallback;
}

function isStrongEmotion(emotionResult) {
  return ['PROTECTIVE', 'AFFECTIONATE', 'FIXATED'].includes(emotionResult?.emotion || '');
}

function needsSupport(analysis) {
  return analysis?.intent === 'help' || analysis?.sentiment === 'negative';
}

function resolvePerformanceProfile({
  isPrivate,
  routeCategory,
  analysis,
  emotionResult,
  conversationState,
  hasRecentContext,
}) {
  const strongEmotion = isStrongEmotion(emotionResult);
  const supportLike = needsSupport(analysis);
  const recentMessageCount = conversationState?.messages?.length || 0;
  const hasDeepFollowUpContext = recentMessageCount >= 4 || Boolean(conversationState?.rollingSummary);

  if (routeCategory === 'knowledge_qa') {
    return 'knowledge_chat';
  }

  if (routeCategory === 'poke') {
    return 'fast_chat';
  }

  if (
    routeCategory === 'group_chat'
    && !supportLike
    && !strongEmotion
    && (analysis?.relevance || 0) < 0.85
  ) {
    return 'fast_chat';
  }

  if (
    routeCategory === 'private_chat'
    && !hasRecentContext
    && !supportLike
    && !strongEmotion
    && analysis?.intent !== 'query'
  ) {
    return 'fast_chat';
  }

  if (
    routeCategory === 'follow_up'
    && !supportLike
    && !strongEmotion
    && !hasDeepFollowUpContext
  ) {
    return 'fast_chat';
  }

  if (
    routeCategory === 'cold_start'
    && !supportLike
    && !strongEmotion
    && !isPrivate
  ) {
    return 'fast_chat';
  }

  return 'standard_chat';
}

function buildGuidance(event, tier, performanceProfile) {
  const isPrivate = event.chatType === 'private';
  if (performanceProfile === 'knowledge_chat') {
    return '这是知识或设定类回复。先把信息讲清楚，再保留一点由乃的语气。';
  }

  if (performanceProfile === 'fast_chat') {
    return isPrivate
      ? '这是轻量私聊回复。先接住当前这句话，用 2 到 4 句中文直接说清楚，不要铺垫太久。'
      : '这是轻量群聊回复。先接话，再补一句态度，2 到 3 句内收住，不要拖成长段。';
  }

  if (tier === 'concise') {
    return isPrivate
      ? '这一轮偏短。私聊直接回应重点，保持温度，但不要写成长段。'
      : '这一轮偏短。群聊利落接话就够了，不要刷屏。';
  }

  if (tier === 'expanded') {
    return isPrivate
      ? '这一轮可以写得更完整。私聊先回答，再顺一层情绪或细节，必要时轻轻追问。'
      : '这一轮可以比平时更展开一点，但群聊仍然要有节奏，别写成墙。';
  }

  return isPrivate
    ? '这一轮保持均衡。私聊答完整一点，语气自然，必要时可以顺手接一句。'
    : '这一轮保持均衡。群聊要像在场的人一样会接话，但仍然收得住。';
}

function buildGenerationProfile({
  isPrivate,
  routeCategory,
  analysis,
  emotionResult,
  hasRecentContext,
  performanceProfile,
}) {
  let historyLimit = isPrivate ? 5 : 4;
  let temperature = isPrivate ? 0.64 : 0.54;
  let promptProfile = 'compact';

  if (performanceProfile === 'knowledge_chat' || routeCategory === 'knowledge_qa') {
    historyLimit = isPrivate ? 8 : 5;
    temperature = 0.38;
    promptProfile = 'standard';
  } else if (performanceProfile === 'fast_chat') {
    historyLimit = isPrivate ? 3 : 2;
    temperature = isPrivate ? 0.56 : 0.48;
    promptProfile = 'fast';
  } else if (routeCategory === 'follow_up' && hasRecentContext) {
    historyLimit = isPrivate ? 7 : 5;
    temperature = isPrivate ? 0.62 : 0.54;
    promptProfile = 'standard';
  } else if (routeCategory === 'cold_start') {
    historyLimit = isPrivate ? 5 : 4;
    temperature = isPrivate ? 0.68 : 0.56;
    promptProfile = 'compact';
  } else if (routeCategory === 'poke') {
    historyLimit = 2;
    temperature = 0.5;
    promptProfile = 'fast';
  }

  if (needsSupport(analysis)) {
    historyLimit = Math.max(historyLimit, isPrivate ? 7 : 5);
    temperature = Math.min(temperature, 0.56);
    promptProfile = 'standard';
  }

  if ((analysis?.relevance || 0) >= 0.85 && routeCategory === 'group_chat') {
    historyLimit = Math.max(historyLimit, 5);
    promptProfile = 'standard';
  }

  if (isStrongEmotion(emotionResult)) {
    historyLimit = Math.max(historyLimit, isPrivate ? 7 : 5);
    promptProfile = 'standard';
  }

  return {
    historyLimit,
    temperature,
    promptProfile,
  };
}

export function resolveReplyLengthProfile({
  event,
  route,
  analysis,
  emotionResult,
  conversationState,
} = {}) {
  const isPrivate = event?.chatType === 'private';
  const routeCategory = String(route?.category || (isPrivate ? 'private_chat' : 'group_chat'));
  const hasRecentContext = Boolean(conversationState?.rollingSummary)
    || (conversationState?.messages?.length || 0) >= 2;

  let tier = normalizeTier(
    isPrivate ? config.privateReplyLengthTier : config.groupReplyLengthTier,
    isPrivate ? 'expanded' : 'balanced'
  );
  let maxTokens = isPrivate ? config.privateChatMaxTokens : config.groupChatMaxTokens;
  let reason = isPrivate ? 'private-default' : 'group-default';

  if (routeCategory === 'knowledge_qa') {
    tier = 'expanded';
    maxTokens = config.knowledgeReplyMaxTokens;
    reason = 'knowledge-route';
  } else if (routeCategory === 'follow_up' && hasRecentContext) {
    tier = 'expanded';
    maxTokens = isPrivate ? config.privateChatMaxTokens : Math.max(config.groupChatMaxTokens, 420);
    reason = 'follow-up-route';
  } else if (routeCategory === 'cold_start') {
    tier = isPrivate ? 'expanded' : 'balanced';
    maxTokens = isPrivate ? config.privateChatMaxTokens : config.groupChatMaxTokens;
    reason = 'cold-start-route';
  } else if (routeCategory === 'poke') {
    tier = 'concise';
    maxTokens = isPrivate ? 160 : 96;
    reason = 'poke-fast-path';
  }

  if (analysis?.intent === 'help') {
    tier = 'expanded';
    maxTokens = Math.max(maxTokens, isPrivate ? config.privateChatMaxTokens : 420);
    reason = 'supportive-intent';
  } else if (
    analysis?.intent === 'social'
    && analysis?.sentiment === 'positive'
    && routeCategory !== 'knowledge_qa'
  ) {
    tier = isPrivate ? 'expanded' : 'balanced';
    maxTokens = Math.max(maxTokens, isPrivate ? config.privateChatMaxTokens : config.groupChatMaxTokens);
    reason = 'positive-social-intent';
  } else if ((analysis?.relevance || 0) >= 0.85 && routeCategory === 'group_chat') {
    tier = 'expanded';
    maxTokens = Math.max(maxTokens, 420);
    reason = 'high-relevance-group';
  }

  if (isStrongEmotion(emotionResult)) {
    maxTokens = Math.max(maxTokens, isPrivate ? config.privateChatMaxTokens : config.groupChatMaxTokens);
    if (tier === 'concise') {
      tier = 'balanced';
    }
  }

  const performanceProfile = resolvePerformanceProfile({
    isPrivate,
    routeCategory,
    analysis,
    emotionResult,
    conversationState,
    hasRecentContext,
  });

  if (performanceProfile === 'fast_chat') {
    tier = tier === 'expanded' ? 'balanced' : tier;
    maxTokens = Math.min(maxTokens, isPrivate ? 320 : 240);
    reason = `${reason}+fast-chat`;
  }

  const generationProfile = buildGenerationProfile({
    isPrivate,
    routeCategory,
    analysis,
    emotionResult,
    hasRecentContext,
    performanceProfile,
  });

  return {
    tier,
    maxTokens,
    reason,
    routeCategory,
    guidance: buildGuidance(event || { chatType: isPrivate ? 'private' : 'group' }, tier, performanceProfile),
    historyLimit: generationProfile.historyLimit,
    temperature: generationProfile.temperature,
    promptProfile: generationProfile.promptProfile,
    performanceProfile,
  };
}
