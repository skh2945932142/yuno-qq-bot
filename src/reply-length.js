import { config } from './config.js';

function normalizeTier(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['concise', 'balanced', 'expanded'].includes(normalized)
    ? normalized
    : fallback;
}

function buildGuidance(event, tier) {
  const isPrivate = event.chatType === 'private';
  const sceneLabel = isPrivate ? 'private chat' : 'group chat';

  if (tier === 'concise') {
    return `Length mode: concise. In this ${sceneLabel}, answer in a compact, direct way. One short beat is enough.`;
  }

  if (tier === 'expanded') {
    return isPrivate
      ? 'Length mode: expanded. In private chat, give a fuller and emotionally complete reply with smooth transitions.'
      : 'Length mode: expanded. In group chat, be noticeably more talkative than before, but still avoid wall-of-text spam.';
  }

  return isPrivate
    ? 'Length mode: balanced. In private chat, reply with a complete and warm answer and allow one soft follow-up.'
    : 'Length mode: balanced. In group chat, be chatty enough to feel alive, but still keep rhythm and brevity.';
}

function buildGenerationProfile({ isPrivate, routeCategory, analysis, emotionResult, hasRecentContext }) {
  let historyLimit = isPrivate ? 6 : 4;
  let temperature = isPrivate ? 0.7 : 0.58;
  let promptProfile = isPrivate ? 'standard' : 'compact';

  if (routeCategory === 'knowledge_qa') {
    historyLimit = isPrivate ? 8 : 5;
    temperature = 0.38;
    promptProfile = 'standard';
  } else if (routeCategory === 'follow_up' && hasRecentContext) {
    historyLimit = isPrivate ? 8 : 6;
    temperature = isPrivate ? 0.66 : 0.56;
    promptProfile = 'standard';
  } else if (routeCategory === 'cold_start') {
    historyLimit = isPrivate ? 6 : 4;
    temperature = isPrivate ? 0.72 : 0.6;
    promptProfile = isPrivate ? 'standard' : 'compact';
  } else if (routeCategory === 'poke') {
    historyLimit = 2;
    temperature = 0.5;
    promptProfile = 'fast';
  }

  if (analysis?.intent === 'help') {
    historyLimit = Math.max(historyLimit, isPrivate ? 7 : 5);
    temperature = Math.min(temperature, 0.56);
    promptProfile = 'standard';
  }

  if ((analysis?.relevance || 0) >= 0.85 && routeCategory === 'group_chat') {
    historyLimit = Math.max(historyLimit, 5);
    promptProfile = 'standard';
  }

  if (['PROTECTIVE', 'AFFECTIONATE', 'FIXATED'].includes(emotionResult?.emotion || '')) {
    historyLimit = Math.max(historyLimit, isPrivate ? 7 : 5);
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

  if (['PROTECTIVE', 'AFFECTIONATE', 'FIXATED'].includes(emotionResult?.emotion || '')) {
    maxTokens = Math.max(maxTokens, isPrivate ? config.privateChatMaxTokens : config.groupChatMaxTokens);
    if (tier === 'concise') {
      tier = 'balanced';
    }
  }

  const generationProfile = buildGenerationProfile({
    isPrivate,
    routeCategory,
    analysis,
    emotionResult,
    hasRecentContext,
  });

  return {
    tier,
    maxTokens,
    reason,
    routeCategory,
    guidance: buildGuidance(event || { chatType: isPrivate ? 'private' : 'group' }, tier),
    historyLimit: generationProfile.historyLimit,
    temperature: generationProfile.temperature,
    promptProfile: generationProfile.promptProfile,
  };
}
