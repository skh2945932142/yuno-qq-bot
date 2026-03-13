import { config, isAdvancedGroup } from '../config.js';
import { analyzeMessage } from '../minimax.js';
import {
  clamp,
  extractAtTargets,
  inferIntent,
  inferSentiment,
  stripCqCodes,
} from '../utils.js';

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

function buildRuleSignals(event, context, options = {}) {
  const message = event.raw_message || '';
  const normalized = stripCqCodes(message);
  const selfId = String(event.self_id || '');
  const groupId = String(event.group_id || '');
  const atTargets = extractAtTargets(message);
  const isAdmin = String(event.user_id || '') === config.adminQq;
  const directMention = Boolean(selfId) && atTargets.includes(selfId);

  const nameMention = /由乃|yuno/i.test(normalized);
  const question = /[?？]$/.test(normalized) || /(怎么|如何|为什么|为啥|吗|么)\b/i.test(normalized);
  const keyword = /(帮助|命令|问题|状态|关系|好感|画像|群状态|情绪)/i.test(normalized);
  const highAffection = (context.relation?.affection || 0) >= 70;
  const recentActiveUser = (context.relation?.activeScore || 0) >= 65;
  const groupActiveWindow = (context.groupState?.activityLevel || 0) >= 60;

  const randomFn = options.random ?? (() => Math.random());
  const random = randomFn() < (isAdvancedGroup(groupId) ? 0.02 : 0.01);

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
    atTargets,
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
  const rule = buildRuleSignals(event, context, options);
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

  if (!rule.directMention) {
    return buildHeuristicResult({
      shouldRespond: false,
      confidence: clamp(rule.score, 0, 1),
      intent,
      sentiment,
      relevance: 0.1,
      reason: 'direct-mention-required',
      ruleSignals: rule.signals,
      replyStyle: 'calm',
      topics: context.topics || [],
    });
  }

  if (!isAdvancedGroup(groupId)) {
    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(Math.max(rule.score, 0.75), 0, 1),
      intent,
      sentiment,
      relevance: 0.8,
      reason: 'basic-direct-mention-pass',
      ruleSignals: rule.signals,
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
      topics: context.topics || [],
    });
  }

  const strongRulePass = rule.directMention;
  if (strongRulePass) {
    return buildHeuristicResult({
      shouldRespond: true,
      confidence: clamp(Math.max(rule.score, 0.8), 0, 1),
      intent,
      sentiment,
      relevance: 0.85,
      reason: 'advanced-direct-mention-pass',
      ruleSignals: rule.signals,
      replyStyle: sentiment === 'negative' ? 'sharp' : 'calm',
    });
  }

  const messageAnalyzer = options.messageAnalyzer || analyzeMessage;
  const llm = await messageAnalyzer(message, {
    affection: context.relation?.affection,
    activeScore: context.relation?.activeScore,
    groupMood: context.groupState?.mood,
    groupActivity: context.groupState?.activityLevel,
    isAdmin: rule.isAdmin,
    ruleSignals: rule.signals,
  });

  return buildHeuristicResult({
    shouldRespond: Boolean(llm.shouldReply),
    confidence: Number(llm.confidence) || 0.5,
    intent: llm.intent || intent,
    sentiment: llm.sentiment || sentiment,
    relevance: Number(llm.relevance) || 0.5,
    reason: llm.reason || 'llm-analysis',
    topics: llm.topics || [],
    ruleSignals: rule.signals,
    replyStyle: llm.replyStyle || 'calm',
  });
}
