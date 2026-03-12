import { config, isAdvancedGroup } from '../config.js';
import { analyzeMessage } from '../minimax.js';
import { clamp, inferIntent, inferSentiment, stripCqCodes } from '../utils.js';

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
  };
}

function buildRuleSignals(event, context) {
  const message = event.raw_message || '';
  const normalized = stripCqCodes(message);
  const selfId = String(event.self_id || '');
  const groupId = String(event.group_id || '');
  const isAdmin = String(event.user_id || '') === config.adminQq;
  const directMention = message.includes(`[CQ:at,qq=${selfId}]`);
  const nameMention = /由乃|yuno/i.test(normalized);
  const question = /[?？]$/.test(normalized) || /(怎么|如何|为什么|为啥|吗|呢)\b/i.test(normalized);
  const keyword = /(帮助|命令|问题|状态|关系|好感|画像|群状态|情绪)/i.test(normalized);
  const highAffection = (context.relation?.affection || 0) >= 70;
  const recentActiveUser = (context.relation?.activeScore || 0) >= 65;
  const groupActiveWindow = (context.groupState?.activityLevel || 0) >= 60;
  const random = Math.random() < (isAdvancedGroup(groupId) ? 0.02 : 0.01);

  const signals = [];
  let score = 0;

  if (directMention) {
    score += 0.8;
    signals.push('direct-mention');
  }
  if (nameMention) {
    score += 0.45;
    signals.push('name-mention');
  }
  if (question) {
    score += 0.25;
    signals.push('question');
  }
  if (keyword) {
    score += 0.35;
    signals.push('keyword');
  }
  if (isAdmin) {
    score += 0.18;
    signals.push('admin');
  }
  if (highAffection) {
    score += 0.12;
    signals.push('high-affection');
  }
  if (recentActiveUser) {
    score += 0.1;
    signals.push('active-user');
  }
  if (groupActiveWindow && (nameMention || directMention)) {
    score += 0.08;
    signals.push('active-window');
  }
  if (random) {
    score += 0.05;
    signals.push('random');
  }

  return {
    score: clamp(score, 0, 1),
    signals,
    directMention,
    nameMention,
    question,
    keyword,
    isAdmin,
    random,
    normalized,
  };
}

export async function analyzeTrigger(event, context = {}, options = {}) {
  const groupId = String(event.group_id || '');
  const message = event.raw_message || '';
  const rule = buildRuleSignals(event, context);
  const sentiment = inferSentiment(message);
  const intent = inferIntent(message);

  if (!rule.normalized) {
    return {
      shouldRespond: false,
      confidence: 0,
      intent: 'ignore',
      sentiment: 'neutral',
      relevance: 0,
      reason: 'empty-message',
      topics: [],
      ruleSignals: rule.signals,
      replyStyle: 'calm',
    };
  }

  if (!isAdvancedGroup(groupId)) {
    const shouldRespond = rule.directMention || rule.nameMention || rule.score >= 0.55;
    return buildHeuristicResult({
      shouldRespond,
      confidence: rule.score,
      intent,
      sentiment,
      relevance: shouldRespond ? 0.7 : 0.25,
      reason: shouldRespond ? 'basic-rule-pass' : 'basic-rule-skip',
      ruleSignals: rule.signals,
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
      topics: context.topics || [],
    });
  }

  const strongRulePass = rule.directMention
    || rule.keyword
    || (rule.nameMention && (rule.question || rule.score >= 0.4))
    || (rule.question && rule.score >= 0.45);

  if (strongRulePass) {
    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(Math.max(rule.score, 0.72), 0, 1),
      intent,
      sentiment,
      relevance: clamp(Math.max(rule.score, 0.75), 0, 1),
      reason: 'advanced-strong-rule-pass',
      ruleSignals: rule.signals,
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
    });
  }

  const highAffinityShortcut = (context.relation?.affection || 0) >= 85
    && (rule.nameMention || rule.question || rule.score >= 0.25);
  if (highAffinityShortcut) {
    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(Math.max(rule.score, 0.66), 0, 1),
      intent,
      sentiment,
      relevance: 0.72,
      reason: 'advanced-high-affection-pass',
      ruleSignals: rule.signals,
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
    });
  }

  const ambiguousRuleWindow = rule.score >= 0.18 && rule.score < 0.55;
  const affectionateAmbiguity = (context.relation?.affection || 0) >= 75 && rule.score >= 0.1;
  const needsDeepAnalysis = ambiguousRuleWindow || affectionateAmbiguity;

  if (!needsDeepAnalysis) {
    return buildHeuristicResult({
      shouldRespond: false,
      confidence: clamp(rule.score, 0, 1),
      intent,
      sentiment,
      relevance: 0.2,
      reason: 'advanced-rule-fast-skip',
      ruleSignals: rule.signals,
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
    });
  }

  const messageAnalyzer = options.messageAnalyzer || analyzeMessage;
  const llm = needsDeepAnalysis
    ? await messageAnalyzer(message, {
        affection: context.relation?.affection,
        activeScore: context.relation?.activeScore,
        groupMood: context.groupState?.mood,
        groupActivity: context.groupState?.activityLevel,
        isAdmin: rule.isAdmin,
        ruleSignals: rule.signals,
      })
    : {
        intent,
        sentiment,
        relevance: 0.18,
        confidence: 0.28,
        shouldReply: false,
        reason: 'rule-precheck-skip',
        topics: [],
        replyStyle: 'calm',
      };

  const finalConfidence = clamp((rule.score * 0.45) + (llm.confidence * 0.55), 0, 1);
  const finalRelevance = clamp((rule.score * 0.4) + (llm.relevance * 0.6), 0, 1);
  const shouldRespond = rule.directMention
    || (llm.shouldReply && finalConfidence >= 0.55 && finalRelevance >= 0.45)
    || (context.relation?.affection >= 85 && finalRelevance >= 0.55);

  return buildHeuristicResult({
    shouldRespond,
    confidence: finalConfidence,
    intent: llm.intent || intent,
    sentiment: llm.sentiment || sentiment,
    relevance: finalRelevance,
    reason: llm.reason,
    topics: llm.topics || [],
    ruleSignals: rule.signals,
    replyStyle: llm.replyStyle || 'calm',
  });
}
