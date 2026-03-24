import { config, isAdvancedGroup } from './config.js';
import { classifyReplyTrigger } from './minimax.js';
import { normalizeLegacyMessageEvent } from './chat/session.js';
import { parseCommand } from './command-parser.js';
import { loadTriggerPolicy } from './trigger-policy.js';
import { getSpecialUserByUserId } from './special-users.js';
import {
  clamp,
  extractAtTargets,
  inferIntent,
  inferSentiment,
  stripCqCodes,
} from './utils.js';

const JEALOUSY_PATTERN = /(别人|其他人|别的女人|别的男人|喜欢谁|谁靠近你|陪别人|看别人|抢走你|情敌)/i;

function buildKeywordPattern(keywords = []) {
  if (!keywords.length) {
    return /$^/;
  }

  return new RegExp(`(${keywords.join('|')})`, 'i');
}

function hasMemoryHit(normalizedText, memories = []) {
  return memories.some((item) => {
    const normalized = String(item || '').trim();
    return normalized && normalizedText.includes(normalized);
  });
}

function buildHeuristicResult({
  shouldRespond,
  confidence,
  intent,
  sentiment,
  relevance,
  reason,
  ruleSignals,
  replyStyle,
  topics = [],
  decisionExplanation = {},
}) {
  return {
    shouldRespond,
    confidence,
    intent,
    sentiment,
    relevance,
    reason,
    topics,
    ruleSignals,
    replyStyle,
    decisionExplanation,
  };
}

function shouldTreatAsAttachmentOnly(event, normalizedText) {
  return !normalizedText && Array.isArray(event.attachments) && event.attachments.length > 0;
}

function isPokeEvent(event) {
  return event?.source?.postType === 'notice'
    && event?.source?.noticeType === 'notify'
    && event?.source?.subType === 'poke';
}

function buildRuleSignals(event, context, policy, options = {}) {
  const normalizedEvent = normalizeLegacyMessageEvent(event);
  const message = normalizedEvent.rawText || '';
  const normalized = stripCqCodes(message);
  const keywordPattern = buildKeywordPattern(policy.keywords);
  const atTargets = extractAtTargets(message);
  const isAdmin = normalizedEvent.userId === config.adminQq;
  const specialUser = context.specialUser || getSpecialUserByUserId(normalizedEvent.userId);
  const directMention = normalizedEvent.chatType === 'group'
    ? Boolean(normalizedEvent.mentionsBot)
      || (normalizedEvent.selfId ? atTargets.includes(normalizedEvent.selfId) : false)
    : false;
  const replyToBot = Boolean(normalizedEvent.replyTo) && directMention;

  const nameMention = /由乃|yuno/i.test(normalized);
  const question = /[?？]$/.test(normalized) || /(怎么|如何|为什么|为啥|能不能|会不会|是不是)/i.test(normalized);
  const keyword = keywordPattern.test(normalized);
  const command = Boolean(parseCommand(normalized)) || /^\/\S+/.test(normalized);
  const poke = isPokeEvent(normalizedEvent);
  const highAffection = (context.relation?.affection || 0) >= 70;
  const recentActiveUser = (context.relation?.activeScore || 0) >= 65;
  const groupActiveWindow = (context.groupState?.activityLevel || 0) >= 60;
  const specialKeyword = Boolean(specialUser)
    && (specialUser.triggerKeywords || []).some((item) => normalized.includes(item));
  const jealousyTopic = JEALOUSY_PATTERN.test(normalized);
  const bondMemoryHit = Boolean(specialUser) && hasMemoryHit(normalized, [
    ...(context.userProfile?.bondMemories || []),
    ...(specialUser?.memorySeeds || []),
    ...(context.userProfile?.specialNicknames || []),
  ]);

  const randomFn = options.random ?? (() => Math.random());
  const random = normalizedEvent.chatType === 'group'
    && randomFn() < (isAdvancedGroup(normalizedEvent.chatId) ? 0.02 : 0.01);

  const signals = [];
  let score = 0;

  function applyWeight(condition, weightName, signalName) {
    if (!condition) return;
    score += Number(policy.weights[weightName] || 0);
    signals.push(signalName);
  }

  applyWeight(directMention, 'directMention', 'direct-mention');
  applyWeight(replyToBot, 'replyToBot', 'reply-to-bot');
  applyWeight(nameMention, 'nameMention', 'name-mention');
  applyWeight(question, 'question', 'question');
  applyWeight(keyword, 'keyword', 'keyword');
  applyWeight(command, 'command', 'command');
  applyWeight(poke, 'poke', 'poke');
  applyWeight(isAdmin, 'admin', 'admin');
  applyWeight(highAffection, 'highAffection', 'high-affection');
  applyWeight(recentActiveUser, 'activeUser', 'active-user');
  applyWeight(groupActiveWindow && (nameMention || directMention), 'activeWindow', 'active-window');
  applyWeight(random, 'random', 'random');
  applyWeight(Boolean(specialUser), 'specialUser', 'special-user');
  applyWeight(specialKeyword, 'specialKeyword', 'special-keyword');
  applyWeight(jealousyTopic, 'jealousyTopic', 'jealousy-topic');
  applyWeight(bondMemoryHit, 'bondMemoryHit', 'bond-memory-hit');

  return {
    event: normalizedEvent,
    score: clamp(score, 0, 1),
    signals,
    directMention,
    replyToBot,
    nameMention,
    question,
    keyword,
    command,
    poke,
    isAdmin,
    normalized,
    specialUser,
  };
}

function makeDecisionExplanation(rule, extras = {}) {
  return {
    heuristicScore: Number(rule.score || 0),
    signals: rule.signals || [],
    directMention: Boolean(rule.directMention),
    isAdmin: Boolean(rule.isAdmin),
    specialUser: rule.specialUser ? rule.specialUser.label : null,
    classifier: extras.classifier || null,
    hardDecision: extras.hardDecision || null,
    finalDecision: extras.finalDecision || null,
    policy: extras.policy || null,
  };
}

export async function analyzeTrigger(event, context = {}, options = {}) {
  const policy = loadTriggerPolicy(options.triggerPolicy);
  const rule = buildRuleSignals(event, context, policy, options);
  const message = rule.event.rawText || '';
  const sentiment = inferSentiment(message);
  const intent = inferIntent(message);
  const isAttachmentOnly = shouldTreatAsAttachmentOnly(rule.event, rule.normalized);
  const specialUser = rule.specialUser;
  const autoAllowThreshold = specialUser
    ? Math.max(0, (policy.groupChat.specialUserAutoAllowThreshold ?? (policy.groupChat.autoAllowThreshold - 0.12)))
    : policy.groupChat.autoAllowThreshold;
  const classifierAllowThreshold = specialUser
    ? Math.max(0, (policy.groupChat.specialUserClassifierAllowThreshold ?? (policy.groupChat.classifierAllowThreshold - 0.08)))
    : policy.groupChat.classifierAllowThreshold;

  if (!rule.normalized && !isAttachmentOnly) {
    return buildHeuristicResult({
      shouldRespond: false,
      confidence: 0,
      intent: 'ignore',
      sentiment: 'neutral',
      relevance: 0,
      reason: 'empty-message',
      topics: [],
      ruleSignals: rule.signals,
      replyStyle: 'calm',
      decisionExplanation: makeDecisionExplanation(rule, {
        hardDecision: 'deny',
        finalDecision: 'deny',
      }),
    });
  }

  if (policy.hardDeny.ignorePureAttachmentWithoutMention && isAttachmentOnly && !rule.directMention) {
    return buildHeuristicResult({
      shouldRespond: false,
      confidence: 0.15,
      intent,
      sentiment,
      relevance: 0.1,
      reason: 'attachment-without-mention',
      topics: [],
      ruleSignals: rule.signals,
      replyStyle: 'calm',
      decisionExplanation: makeDecisionExplanation(rule, {
        hardDecision: 'deny',
        finalDecision: 'deny',
      }),
    });
  }

  if (rule.event.chatType === 'private' && policy.privateChat.autoAllow) {
    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(Math.max(rule.score, policy.privateChat.minConfidence), 0, 1),
      intent,
      sentiment,
      relevance: clamp(policy.privateChat.minRelevance, 0, 1),
      reason: specialUser ? 'special-private-reply' : 'private-default-reply',
      ruleSignals: [...rule.signals, 'private-chat'],
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
      topics: context.topics || [],
      decisionExplanation: makeDecisionExplanation(rule, {
        hardDecision: 'allow',
        finalDecision: 'allow',
      }),
    });
  }

  if (rule.directMention && policy.groupChat.hardAllowDirectMention) {
    const reason = isAdvancedGroup(rule.event.chatId)
      ? 'advanced-direct-mention-pass'
      : 'basic-direct-mention-pass';

    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(Math.max(rule.score, autoAllowThreshold), 0, 1),
      intent,
      sentiment,
      relevance: isAdvancedGroup(rule.event.chatId) ? 0.85 : 0.8,
      reason,
      ruleSignals: rule.signals,
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
      topics: context.topics || [],
      decisionExplanation: makeDecisionExplanation(rule, {
        hardDecision: 'allow',
        finalDecision: 'allow',
      }),
    });
  }

  if (rule.poke) {
    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(Math.max(rule.score, autoAllowThreshold), 0, 1),
      intent,
      sentiment,
      relevance: 0.88,
      reason: 'poke-trigger',
      ruleSignals: rule.signals,
      replyStyle: 'calm',
      topics: context.topics || [],
      decisionExplanation: makeDecisionExplanation(rule, {
        hardDecision: 'allow',
        finalDecision: 'allow',
      }),
    });
  }

  if (rule.isAdmin && policy.groupChat.hardAllowAdminCommand && (rule.question || rule.keyword)) {
    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(Math.max(rule.score, classifierAllowThreshold), 0, 1),
      intent,
      sentiment,
      relevance: 0.78,
      reason: 'admin-priority-pass',
      ruleSignals: [...rule.signals, 'admin-priority'],
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
      topics: context.topics || [],
      decisionExplanation: makeDecisionExplanation(rule, {
        hardDecision: 'allow',
        finalDecision: 'allow',
      }),
    });
  }

  if (
    rule.event.chatType === 'group'
    && policy.groupChat.requireExplicitTrigger
    && !rule.directMention
    && !rule.keyword
    && !rule.command
    && !rule.poke
    && !rule.specialKeyword
  ) {
    return buildHeuristicResult({
      shouldRespond: false,
      confidence: clamp(rule.score, 0, 1),
      intent,
      sentiment,
      relevance: 0.1,
      reason: 'explicit-trigger-required',
      ruleSignals: rule.signals,
      replyStyle: 'calm',
      topics: context.topics || [],
      decisionExplanation: makeDecisionExplanation(rule, {
        hardDecision: 'deny',
        finalDecision: 'deny',
      }),
    });
  }

  if (rule.score >= autoAllowThreshold) {
    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(rule.score, 0, 1),
      intent,
      sentiment,
      relevance: clamp(Math.max(rule.score, 0.45), 0, 1),
      reason: specialUser ? 'special-heuristic-pass' : 'heuristic-threshold-pass',
      ruleSignals: rule.signals,
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
      topics: context.topics || [],
      decisionExplanation: makeDecisionExplanation(rule, {
        finalDecision: 'allow',
      }),
    });
  }

  const classifierWindow = specialUser
    ? {
        minScore: Math.max(0, (policy.groupChat.requireClassifierWindow.minScore || 0) - 0.08),
        maxScore: policy.groupChat.requireClassifierWindow.maxScore,
      }
    : policy.groupChat.requireClassifierWindow;
  const withinClassifierWindow = rule.score >= classifierWindow.minScore
    && rule.score <= classifierWindow.maxScore;

  if (policy.classifier.enabled && withinClassifierWindow) {
    const classifier = await (options.triggerClassifier || classifyReplyTrigger)(message, {
      platform: rule.event.platform,
      chatType: rule.event.chatType,
      isAdmin: rule.isAdmin,
      heuristicScore: rule.score,
      directMention: rule.directMention,
      ruleSignals: rule.signals,
      recentSummary: context.conversationState?.rollingSummary || '',
      specialUser: specialUser?.label || '',
    }, {
      traceContext: options.traceContext,
      promptVersion: policy.classifier.promptVersion,
      maxTokens: policy.classifier.maxTokens,
    });

    const classifierAllows = Boolean(classifier.shouldRespond)
      && Number(classifier.confidence || 0) >= policy.groupChat.classifierConfidenceThreshold;

    if (classifierAllows) {
      return buildHeuristicResult({
        shouldRespond: true,
        confidence: clamp(Math.max(rule.score, classifier.confidence), 0, 1),
        intent,
        sentiment,
        relevance: clamp(Math.max(rule.score, 0.5), 0, 1),
        reason: 'classifier-allow',
        ruleSignals: [...rule.signals, `classifier:${classifier.category || 'allow'}`],
        replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
        topics: context.topics || [],
        decisionExplanation: makeDecisionExplanation(rule, {
          classifier,
          finalDecision: 'allow',
        }),
      });
    }

    return buildHeuristicResult({
      shouldRespond: false,
      confidence: clamp(rule.score, 0, 1),
      intent,
      sentiment,
      relevance: 0.15,
      reason: 'classifier-deny',
      ruleSignals: [...rule.signals, `classifier:${classifier.category || 'deny'}`],
      replyStyle: 'calm',
      topics: context.topics || [],
      decisionExplanation: makeDecisionExplanation(rule, {
        classifier,
        finalDecision: 'deny',
      }),
    });
  }

  return buildHeuristicResult({
    shouldRespond: false,
    confidence: clamp(rule.score, 0, 1),
    intent,
    sentiment,
    relevance: 0.1,
    reason: policy.groupChat.lowConfidenceFallback === 'deny'
      ? 'group-low-confidence'
      : 'classifier-skipped',
    ruleSignals: rule.signals,
    replyStyle: 'calm',
    topics: context.topics || [],
    decisionExplanation: makeDecisionExplanation(rule, {
      finalDecision: 'deny',
      policy: 'low-confidence-fallback',
    }),
  });
}
