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

function interpretCurrentTurn({ event, routeCategory, analysis, conversationState } = {}) {
  const text = String(event?.rawText || event?.text || '');
  const stripped = text
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const lowerIntent = String(analysis?.intent || '').toLowerCase();
  const negative = analysis?.sentiment === 'negative';
  const hasRecent = hasRecentThread(conversationState);

  let subIntent = '接话';
  if (routeCategory === 'knowledge_qa' || lowerIntent === 'query') subIntent = '要信息';
  if (lowerIntent === 'help') subIntent = negative ? '求安慰和帮助' : '求助';
  if (/(笑死|哈哈|乐子|典中典|蚌埠住了|破防|抽象|逆天|绷不住)/i.test(stripped)) subIntent = '玩梗接话';
  if (/(难受|焦虑|崩溃|委屈|失眠|害怕|累了|烦死)/i.test(stripped)) subIntent = '求安慰';
  if (/(继续|然后呢|展开|细说|后来呢|什么意思)/i.test(stripped) || hasRecent) subIntent = '追问延续';
  if (/(哄哄|抱抱|陪我|在吗|想你)/i.test(stripped)) subIntent = '亲近陪伴';

  let tone = '自然';
  if (subIntent === '求安慰' || subIntent === '亲近陪伴') tone = '温柔贴近';
  else if (subIntent === '玩梗接话') tone = '轻松接梗';
  else if (subIntent === '要信息') tone = '清楚直接';
  else if (negative) tone = '稳一点';

  let expectsDepth = event?.chatType === 'private' ? 'medium' : 'short';
  if (subIntent === '要信息' || subIntent === '求助') expectsDepth = event?.chatType === 'private' ? 'deep' : 'medium';
  if (subIntent === '玩梗接话') expectsDepth = 'short';

  return {
    subIntent,
    tone,
    expectsDepth,
    needsEmpathy: ['求安慰和帮助', '求安慰', '亲近陪伴'].includes(subIntent),
  };
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
  const interpretation = interpretCurrentTurn({
    event,
    routeCategory,
    analysis,
    conversationState,
  });

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
      interpretation,
    };
  }

  if (routeCategory === 'poke') {
    return {
      type: 'direct',
      depth: 'short',
      questionNeeded: false,
      reason: 'poke-fast-response',
      interpretation,
    };
  }

  if (routeCategory === 'follow_up') {
    if (scene === 'private' && supportive) {
      return {
        type: 'empathic_followup',
        depth: 'medium',
        questionNeeded: true,
        reason: 'supportive-follow-up',
        interpretation,
      };
    }

    return {
      type: 'direct_followup',
      depth: scene === 'private' ? 'medium' : 'short',
      questionNeeded: scene === 'private',
      reason: 'follow-up-continue',
      interpretation,
    };
  }

  if (routeCategory === 'cold_start') {
    return {
      type: scene === 'private' ? 'topic_extend' : 'direct_followup',
      depth: scene === 'private' ? 'medium' : 'short',
      questionNeeded: true,
      reason: 'cold-start-hook',
      interpretation,
    };
  }

  if (scene === 'private') {
    if (supportive) {
      return {
        type: 'empathic_followup',
        depth: 'medium',
        questionNeeded: true,
        reason: 'private-supportive',
        interpretation,
      };
    }

    if (shouldAskFollowup || (recentThread && highRelevance)) {
      return {
        type: 'direct_followup',
        depth: 'medium',
        questionNeeded: true,
        reason: 'private-follow-up',
        interpretation,
      };
    }

    return {
      type: 'direct',
      depth: 'short',
      questionNeeded: false,
      reason: 'private-direct',
      interpretation,
    };
  }

  if (supportive) {
    return {
      type: 'direct_followup',
      depth: 'short',
      questionNeeded: false,
      reason: 'group-supportive-conservative',
      interpretation,
    };
  }

  if (shouldAskFollowup && highRelevance) {
    return {
      type: 'direct_followup',
      depth: 'short',
      questionNeeded: true,
      reason: 'group-brief-follow-up',
      interpretation,
    };
  }

  return {
    type: 'direct',
    depth: 'short',
    questionNeeded: false,
    reason: 'group-direct-default',
    interpretation,
  };
}
