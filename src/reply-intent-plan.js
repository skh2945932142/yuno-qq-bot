import { clamp } from './utils.js';
import { config } from './config.js';

function hasRecentThread(conversationState) {
  return Boolean(conversationState?.rollingSummary)
    || (conversationState?.messages?.length || 0) >= 2;
}

function shouldSupportEmotion(analysis) {
  return analysis?.intent === 'help'
    || analysis?.sentiment === 'negative';
}

function normalizeRate(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, 0, 1);
}

export function resolveReplyIntentPlan({
  event,
  route,
  analysis,
  conversationState,
} = {}) {
  const scene = event?.chatType === 'private' ? 'private' : 'group';
  const routeCategory = route?.category || (scene === 'private' ? 'private_chat' : 'group_chat');
  const recentThread = hasRecentThread(conversationState);
  const supportive = shouldSupportEmotion(analysis);
  const highRelevance = Number(analysis?.relevance || 0) >= 0.82;
  const socialLike = ['social', 'chat', 'query'].includes(String(analysis?.intent || ''));

  const followupRate = scene === 'private'
    ? normalizeRate(config.chatFollowupRatePrivate, 0.72)
    : normalizeRate(config.chatFollowupRateGroup, 0.24);
  const followupScore = clamp(
    (Number(analysis?.relevance || 0) * 0.5)
    + (recentThread ? 0.28 : 0)
    + (socialLike ? 0.12 : 0),
    0,
    1
  );
  const shouldAskFollowup = followupScore >= followupRate;

  if (routeCategory === 'knowledge_qa') {
    return {
      type: 'direct',
      depth: scene === 'private' ? 'medium' : 'short',
      questionNeeded: false,
      reason: 'knowledge-answer-first',
    };
  }

  if (routeCategory === 'poke') {
    return {
      type: 'direct',
      depth: 'short',
      questionNeeded: false,
      reason: 'poke-fast-response',
    };
  }

  if (routeCategory === 'follow_up') {
    if (scene === 'private' && supportive) {
      return {
        type: 'empathic_followup',
        depth: 'medium',
        questionNeeded: true,
        reason: 'supportive-follow-up',
      };
    }

    return {
      type: 'direct_followup',
      depth: scene === 'private' ? 'medium' : 'short',
      questionNeeded: scene === 'private',
      reason: 'follow-up-continue',
    };
  }

  if (routeCategory === 'cold_start') {
    return {
      type: scene === 'private' ? 'topic_extend' : 'direct_followup',
      depth: scene === 'private' ? 'medium' : 'short',
      questionNeeded: true,
      reason: 'cold-start-hook',
    };
  }

  if (scene === 'private') {
    if (supportive) {
      return {
        type: 'empathic_followup',
        depth: 'medium',
        questionNeeded: true,
        reason: 'private-supportive',
      };
    }

    if (shouldAskFollowup || (recentThread && highRelevance)) {
      return {
        type: 'direct_followup',
        depth: 'medium',
        questionNeeded: true,
        reason: 'private-follow-up',
      };
    }

    return {
      type: 'direct',
      depth: 'short',
      questionNeeded: false,
      reason: 'private-direct',
    };
  }

  if (supportive) {
    return {
      type: 'direct_followup',
      depth: 'short',
      questionNeeded: false,
      reason: 'group-supportive-conservative',
    };
  }

  if (shouldAskFollowup && highRelevance) {
    return {
      type: 'direct_followup',
      depth: 'short',
      questionNeeded: true,
      reason: 'group-brief-follow-up',
    };
  }

  return {
    type: 'direct',
    depth: 'short',
    questionNeeded: false,
    reason: 'group-direct-default',
  };
}

