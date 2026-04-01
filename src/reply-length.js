import { config } from './config.js';

function normalizeTier(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['concise', 'balanced', 'expanded'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function buildGuidance(event, tier) {
  const isPrivate = event.chatType === 'private';
  const sceneLabel = isPrivate ? 'private chat' : 'group chat';

  if (tier === 'concise') {
    return `Length mode: concise. In this ${sceneLabel}, keep it tight and direct. One compact answer plus at most one short follow-up beat.`;
  }

  if (tier === 'expanded') {
    return isPrivate
      ? 'Length mode: expanded. In private chat, give a fuller and more emotionally complete reply. Aim for 5-8 natural sentences with smooth transitions, but stay conversational.'
      : 'Length mode: expanded. In group chat, be noticeably more talkative than before. Aim for 4-6 natural sentences, add one extra layer of explanation or reaction, but avoid wall-of-text spam.';
  }

  return isPrivate
    ? 'Length mode: balanced. In private chat, reply with a complete and warm answer. Aim for 3-6 natural sentences and allow one soft follow-up.'
    : 'Length mode: balanced. In group chat, be more chatty than before. Aim for 2-4 natural sentences and add one extra reaction, example, or clarifying thought when it helps.';
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

  return {
    tier,
    maxTokens,
    reason,
    routeCategory,
    guidance: buildGuidance(event || { chatType: isPrivate ? 'private' : 'group' }, tier),
  };
}
