import { config } from './config.js';

function normalizeTier(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['concise', 'balanced', 'expanded'].includes(normalized)
    ? normalized
    : fallback;
}

function isStrongEmotion(emotionResult) {
  return ['PROTECTIVE', 'AFFECTIONATE', 'FIXATED', 'DEVOTED'].includes(emotionResult?.emotion || '');
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

  if (routeCategory === 'knowledge_qa') return 'knowledge_chat';
  if (routeCategory === 'poke') return 'fast_chat';
  const directMentionReason = ['basic-direct-mention-pass', 'advanced-direct-mention-pass'].includes(analysis?.reason);

  if (!isPrivate && directMentionReason && routeCategory !== 'knowledge_qa' && !supportLike) {
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
    return '这是知识/设定类回复。先把信息说清楚，再保留一点由乃语气。';
  }

  if (performanceProfile === 'fast_chat') {
    return isPrivate
      ? '这是轻量私聊回复：先接住当前输入，2-4 句内回答清楚，少铺垫。'
      : '这是轻量群聊回复：先短接话，最多补一层，2-3 句内收住。';
  }

  if (tier === 'concise') {
    return isPrivate
      ? '这一轮偏短：先回应重点，再给一句情绪承接。'
      : '这一轮偏短：群聊短接话，不刷屏。';
  }

  if (tier === 'expanded') {
    return isPrivate
      ? '这一轮可更完整：先回答，再补一层细节或情绪，必要时轻追问。'
      : '这一轮可适度展开：群聊最多补一层，不写长文。';
  }

  return isPrivate
    ? '这一轮保持均衡：自然回答，必要时顺手追问一条。'
    : '这一轮保持均衡：会接话，但收得住。';
}

function buildGenerationProfile({
  isPrivate,
  routeCategory,
  analysis,
  emotionResult,
  hasRecentContext,
  performanceProfile,
}) {
  let historyLimit = isPrivate ? 4 : 3;
  let temperature = isPrivate ? 0.62 : 0.52;
  let promptProfile = 'compact';

  if (performanceProfile === 'knowledge_chat' || routeCategory === 'knowledge_qa') {
    historyLimit = isPrivate ? 6 : 4;
    temperature = 0.36;
    promptProfile = 'standard';
  } else if (performanceProfile === 'fast_chat') {
    historyLimit = isPrivate ? 2 : 1;
    temperature = isPrivate ? 0.54 : 0.46;
    promptProfile = 'fast';
  } else if (routeCategory === 'follow_up' && hasRecentContext) {
    historyLimit = isPrivate ? 5 : 4;
    temperature = isPrivate ? 0.6 : 0.52;
    promptProfile = 'compact';
  } else if (routeCategory === 'cold_start') {
    historyLimit = isPrivate ? 4 : 3;
    temperature = isPrivate ? 0.66 : 0.54;
    promptProfile = 'compact';
  } else if (routeCategory === 'poke') {
    historyLimit = 1;
    temperature = 0.5;
    promptProfile = 'fast';
  }

  if (needsSupport(analysis)) {
    historyLimit = Math.max(historyLimit, isPrivate ? 5 : 4);
    temperature = Math.min(temperature, 0.54);
    promptProfile = 'compact';
  }

  if ((analysis?.relevance || 0) >= 0.85 && routeCategory === 'group_chat') {
    historyLimit = Math.max(historyLimit, 4);
    promptProfile = 'compact';
  }

  if (isStrongEmotion(emotionResult)) {
    historyLimit = Math.max(historyLimit, isPrivate ? 5 : 4);
    promptProfile = 'compact';
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
    maxTokens = isPrivate ? Math.min(config.privateChatMaxTokens, 420) : Math.max(config.groupChatMaxTokens, 360);
    reason = 'follow-up-route';
  } else if (routeCategory === 'cold_start') {
    tier = isPrivate ? 'balanced' : 'balanced';
    maxTokens = isPrivate ? Math.min(config.privateChatMaxTokens, 380) : config.groupChatMaxTokens;
    reason = 'cold-start-route';
  } else if (routeCategory === 'poke') {
    tier = 'concise';
    maxTokens = isPrivate ? 120 : 80;
    reason = 'poke-fast-path';
  }

  if (analysis?.intent === 'help') {
    tier = 'expanded';
    maxTokens = Math.max(maxTokens, isPrivate ? 420 : 360);
    reason = 'supportive-intent';
  } else if (
    analysis?.intent === 'social'
    && analysis?.sentiment === 'positive'
    && routeCategory !== 'knowledge_qa'
  ) {
    tier = isPrivate ? 'balanced' : 'balanced';
    maxTokens = Math.max(maxTokens, isPrivate ? 360 : config.groupChatMaxTokens);
    reason = 'positive-social-intent';
  } else if ((analysis?.relevance || 0) >= 0.85 && routeCategory === 'group_chat') {
    tier = 'balanced';
    maxTokens = Math.max(maxTokens, 360);
    reason = 'high-relevance-group';
  }

  if (isStrongEmotion(emotionResult)) {
    maxTokens = Math.max(maxTokens, isPrivate ? 360 : config.groupChatMaxTokens);
    if (tier === 'concise') tier = 'balanced';
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
    maxTokens = Math.min(maxTokens, isPrivate ? 220 : 140);
    reason = `${reason}+fast-chat`;
  }

  if (
    !isPrivate
    && routeCategory === 'cold_start'
    && !needsSupport(analysis)
    && !isStrongEmotion(emotionResult)
  ) {
    maxTokens = Math.min(maxTokens, 140);
    reason = `${reason}+group-cold-start-cap`;
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
