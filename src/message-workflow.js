import { config } from './config.js';
import { logger } from './logger.js';
import { chat, tts } from './minimax.js';
import { sendReply, sendStructuredReply, sendVoice } from './sender.js';
import { analyzeTrigger, analyzeTriggerFast } from './message-analysis.js';
import { resolveEmotion, shouldSendVoiceForEmotion } from './emotion-engine.js';
import {
  canUseAdvancedGroupFeatures,
  ensureGroupState,
  getRecentEvents,
  recordGroupEvent,
  updateGroupStateFromAnalysis,
} from './state/group-state.js';
import {
  ensureRelation,
  ensureUserState,
  updateRelationProfile,
  updateUserState,
} from './session-state.js';
import { getConversationState, appendConversationMessages } from './conversation-memory.js';
import { ensureUserProfileMemory, updateUserProfileMemory } from './profile-memory.js';
import { retrieveKnowledge } from './knowledge-base.js';
import { buildReplyContext } from './prompt-builder.js';
import { createTraceContext, failTrace, finalizeTrace, withTraceSpan } from './runtime-tracing.js';
import { planIncomingTask } from './task-router.js';
import { registerQueryTools } from './query-tools.js';
import { toolRegistry } from './tools/registry.js';
import { normalizeLegacyMessageEvent } from './chat/session.js';
import { stripCqCodes } from './utils.js';
import { getRuntimeServices } from './runtime-services.js';
import { recordWorkflowMetric } from './metrics.js';
import { getSpecialUserByUserId, getSpecialUserKnowledgeTags } from './special-users.js';
import { resolveUserPersonaPolicy } from './persona-policy.js';
import { formatToolResultAsYuno, normalizeFormatterOutputs } from './yuno-formatter.js';
import { resolveReplyLengthProfile } from './reply-length.js';
import { resolveReplyIntentPlan } from './reply-intent-plan.js';

registerQueryTools(toolRegistry);

const ALLOWED_SOFT_EMOJIS = new Set(['\u2764', '\u2665', '\u{1F495}', '\u{1F49E}', '\u2728']);
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const THINK_BLOCK_REGEX = /<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi;
const OPEN_THINK_BLOCK_REGEX = /<(think|thinking)\b[^>]*>[\s\S]*$/i;
const GROUP_REPLY_THROTTLE_WINDOW_MS = 25 * 1000;
const GROUP_REPLY_THROTTLE_AFTER = 2;
const GROUP_REPLY_THROTTLE_HINT = '我在听，慢一点说，我一条条接住。';
const GROUP_REPLY_THROTTLE_CACHE_TTL_MS = 10 * 60 * 1000;
const groupReplyBursts = new Map();

function summarizeIncomingMessage(username, text) {
  const cleaned = stripCqCodes(text).slice(0, 80);
  if (!cleaned) return '';
  return `${username}: ${cleaned}`;
}

export function enforceEmojiBudget(text, emotionResult) {
  const budget = emotionResult?.emojiBudget ?? 0;
  const style = emotionResult?.emojiStyle || 'none';
  let used = 0;

  const sanitized = String(text || '').replace(EMOJI_REGEX, (emoji) => {
    if (budget <= 0) {
      return '';
    }

    if (style === 'soft' && !ALLOWED_SOFT_EMOJIS.has(emoji)) {
      return '';
    }

    if (used >= budget) {
      return '';
    }

    used += 1;
    return emoji;
  });

  return sanitized
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function isLikelyStructuredLine(line) {
  const normalized = String(line || '').trim();
  if (!normalized) return false;
  return /^([*-]|#{1,6}\s|\d+[.)]|[A-Za-z0-9_/-]+\s*:|```)/.test(normalized);
}

function joinReplyLines(lines) {
  return lines.reduce((result, line, index) => {
    const current = String(line || '').trim();
    if (!current) return result;
    if (index === 0) return current;

    const previous = result.slice(-1);
    const needsSpace = /[A-Za-z0-9]$/.test(result) && /^[A-Za-z0-9]/.test(current);
    return `${result}${needsSpace ? ' ' : ''}${current}`;
  }, '');
}

function normalizeEllipsis(text, limit = 2) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.round(Number(limit))) : 2;
  const target = '…'.repeat(Math.min(safeLimit, 3));
  return String(text || '').replace(/(\.{3,}|…{2,}|\.{2,}…+|…+\.{2,})/g, target);
}

function dedupeConsecutiveShortSentences(text) {
  const input = String(text || '').trim();
  if (!input) return '';
  const segments = input.match(/[^。！？!?…]+[。！？!?…]?/g);
  if (!segments || segments.length < 2) return input;

  const kept = [];
  let previousCanonical = '';
  for (const segment of segments) {
    const normalized = segment.trim();
    if (!normalized) continue;

    const canonical = normalized
      .replace(/[，,。！？!?…\s]/g, '')
      .toLowerCase()
      .slice(0, 24);
    const shortSegment = normalized.length <= 26;
    if (shortSegment && canonical && canonical === previousCanonical) {
      continue;
    }

    kept.push(normalized);
    previousCanonical = canonical;
  }

  return kept.join('');
}

function isModelUnavailableError(error) {
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.status || error?.response?.status || 0);
  return code === 'MODEL_TIMEOUT'
    || code === 'MODEL_CIRCUIT_OPEN'
    || code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
    || status === 429
    || status >= 500;
}

function buildModelFallbackReply(event, task, error) {
  const route = task?.category || 'chat';
  const reason = String(error?.code || '').toUpperCase();
  const isPrivate = event?.chatType === 'private';

  if (route === 'knowledge_qa') {
    return isPrivate
      ? '我这边刚才查资料有点卡住了。你把问题再发我一次，我优先给你补全。'
      : '我这边刚才查资料卡了一下，你再说一次，我马上补上。';
  }

  if (reason === 'MODEL_CIRCUIT_OPEN') {
    return isPrivate
      ? '我这边刚刚短暂拥堵了，但我还在。你再发一次，我优先接你这条。'
      : '我这边刚刚短暂拥堵了，你再发一次，我立刻接上。';
  }

  if (reason === 'MODEL_TIMEOUT') {
    return isPrivate
      ? '我刚才卡了一下，还在听你。把刚刚那句再发我一次，我马上接。'
      : '我这边刚卡了一下，你再说一次，我马上接。';
  }

  return isPrivate
    ? '我这边刚才有点抖动，但我还在。你再发一次，我接着说。'
    : '我这边刚才有点抖动，你再说一次，我马上接。';
}

export function shapeChatReplyText(text, emotionResult) {
  let output = normalizeReplyFormatting(enforceEmojiBudget(text, emotionResult));
  output = normalizeEllipsis(output, config.chatEllipsisLimit);

  if (config.chatStyleRepeatGuard) {
    output = dedupeConsecutiveShortSentences(output);
  }

  return output
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeReplyFormatting(text) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  if (!normalized.includes('\n')) {
    return normalized;
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return lines[0] || '';
  }

  if (lines.some(isLikelyStructuredLine)) {
    return lines.join('\n');
  }

  return joinReplyLines(lines)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function stripHiddenReasoning(text) {
  return String(text || '')
    .replace(THINK_BLOCK_REGEX, ' ')
    .replace(OPEN_THINK_BLOCK_REGEX, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveUserTurn(event) {
  const cleanText = stripCqCodes(event.rawText || event.text || '');
  if (cleanText) return cleanText;

  if ((event.attachments || []).some((item) => item.type === 'face')) return `[${event.userName} 发来了一张表情]`;
  if ((event.attachments || []).some((item) => item.type === 'image')) return `[${event.userName} 发来了一张图片]`;
  if ((event.attachments || []).some((item) => item.type === 'record')) return `[${event.userName} 发来了一条语音]`;
  if ((event.attachments || []).some((item) => item.type === 'video')) return `[${event.userName} 发来了一段视频]`;
  if ((event.attachments || []).length > 0) return `[${event.userName} 发来了一条消息]`;

  return cleanText;
}

function pruneReplyThrottleCache(now = Date.now()) {
  const cutoff = now - GROUP_REPLY_THROTTLE_CACHE_TTL_MS;
  for (const [key, value] of groupReplyBursts.entries()) {
    if ((value?.lastSeenAt || 0) < cutoff) {
      groupReplyBursts.delete(key);
    }
  }
}

function consumeGroupReplyThrottle(event, task) {
  if (event?.chatType !== 'group' || task?.type !== 'chat') {
    return { throttled: false };
  }

  const now = Date.now();
  pruneReplyThrottleCache(now);
  const key = `${event.chatId}:${event.userId}`;
  const previous = groupReplyBursts.get(key);

  if (!previous || now - previous.lastSeenAt > GROUP_REPLY_THROTTLE_WINDOW_MS) {
    groupReplyBursts.set(key, { count: 1, lastSeenAt: now });
    return { throttled: false, count: 1 };
  }

  const next = {
    count: previous.count + 1,
    lastSeenAt: now,
  };
  groupReplyBursts.set(key, next);

  if (next.count > GROUP_REPLY_THROTTLE_AFTER) {
    return {
      throttled: true,
      count: next.count,
      hint: GROUP_REPLY_THROTTLE_HINT,
    };
  }

  return { throttled: false, count: next.count };
}

function createWorkflowDeps(deps = {}) {
  const runtimeServices = getRuntimeServices();

  return {
    analyzeTrigger: deps.analyzeTrigger || analyzeTrigger,
    analyzeTriggerFast: deps.analyzeTriggerFast || analyzeTriggerFast,
    planIncomingTask: deps.planIncomingTask || planIncomingTask,
    ensureRelation: deps.ensureRelation || ensureRelation,
    ensureUserState: deps.ensureUserState || ensureUserState,
    ensureUserProfileMemory: deps.ensureUserProfileMemory || ensureUserProfileMemory,
    getConversationState: deps.getConversationState || getConversationState,
    ensureGroupState: deps.ensureGroupState || ensureGroupState,
    getRecentEvents: deps.getRecentEvents || getRecentEvents,
    updateRelationProfile: deps.updateRelationProfile || updateRelationProfile,
    updateUserState: deps.updateUserState || updateUserState,
    appendConversationMessages: deps.appendConversationMessages || appendConversationMessages,
    updateUserProfileMemory: deps.updateUserProfileMemory || updateUserProfileMemory,
    retrieveKnowledge: deps.retrieveKnowledge || retrieveKnowledge,
    recordGroupEvent: deps.recordGroupEvent || recordGroupEvent,
    updateGroupStateFromAnalysis: deps.updateGroupStateFromAnalysis || updateGroupStateFromAnalysis,
    resolveEmotion: deps.resolveEmotion || resolveEmotion,
    shouldSendVoiceForEmotion: deps.shouldSendVoiceForEmotion || shouldSendVoiceForEmotion,
    buildReplyContext: deps.buildReplyContext || buildReplyContext,
    chat: deps.chat || chat,
    tts: deps.tts || tts,
    sendReply: deps.sendReply || sendReply,
    sendStructuredReply: deps.sendStructuredReply || sendStructuredReply,
    sendVoice: deps.sendVoice || sendVoice,
    toolRegistry: deps.toolRegistry || toolRegistry,
    enqueuePersistJob: deps.enqueuePersistJob || runtimeServices.queueManager?.enqueuePersist || null,
  };
}

function shouldUseLightweightContext(event, analysis = null) {
  if (analysis?.reason === 'poke-trigger') {
    return true;
  }

  if (analysis?.reason === 'command-trigger') {
    return true;
  }

  if (
    event?.chatType === 'group'
    && ['basic-direct-mention-pass', 'keyword-pass'].includes(analysis?.reason)
  ) {
    return true;
  }

  const normalizedText = stripCqCodes(event?.rawText || event?.text || '');
  return event?.source?.postType === 'message' && /^\/\S+/.test(normalizedText);
}

export async function buildWorkflowContext(event, trace, deps, options = {}) {
  const session = {
    platform: event.platform,
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
  };
  const isAdvanced = event.chatType === 'group' && canUseAdvancedGroupFeatures(event.chatId);
  const lightweight = Boolean(options.lightweight);
  const specialUser = getSpecialUserByUserId(event.userId);

  const [relation, userState, userProfile, conversationState, groupState, recentEvents] = await withTraceSpan(
    trace,
    'load-context',
    () => Promise.all([
      deps.ensureRelation(session),
      deps.ensureUserState(session),
      deps.ensureUserProfileMemory({ platform: event.platform, userId: event.userId, userName: event.userName, specialUser }),
      deps.getConversationState(session),
      isAdvanced && !lightweight ? deps.ensureGroupState(event.chatId) : Promise.resolve(null),
      isAdvanced && !lightweight ? deps.getRecentEvents(event.chatId, 5) : Promise.resolve([]),
    ]),
    {
      chatType: event.chatType,
      chatId: event.chatId,
      userId: event.userId,
      contextMode: lightweight ? 'lightweight' : 'full',
    }
  );

  return {
    event,
    session,
    relation,
    userState,
    userProfile,
    conversationState,
    groupState,
    recentEvents,
    specialUser,
    isAdmin: event.userId === config.adminQq,
    isAdvanced,
    contextMode: lightweight ? 'lightweight' : 'full',
  };
}

async function resolveContext(event, precomputed, trace, deps, options) {
  if (precomputed?.relation && precomputed?.userState && precomputed?.conversationState) {
    return {
      ...precomputed,
      event,
      trace,
    };
  }

  const context = await buildWorkflowContext(event, trace, deps, {
    lightweight: shouldUseLightweightContext(event, precomputed?.analysis),
  });
  if (precomputed?.analysis) {
    return {
      ...context,
      analysis: precomputed.analysis,
      trace,
    };
  }

  const decision = await shouldRespondToEvent(event, { ...options, trace, deps });
  return {
    ...context,
    analysis: decision.analysis,
    trace,
  };
}

export async function shouldRespondToEvent(event, options = {}) {
  const deps = createWorkflowDeps(options.deps);
  const normalizedEvent = normalizeLegacyMessageEvent(event);
  const trace = options.trace || createTraceContext('should-respond', {
    chatType: normalizedEvent.chatType,
    chatId: normalizedEvent.chatId,
    userId: normalizedEvent.userId,
    messageId: normalizedEvent.messageId,
    queueJobId: options.queueJobId,
  });

  try {
    const fastAnalysis = deps.analyzeTriggerFast(normalizedEvent, {
      ...options,
      traceContext: trace,
    });

    if (fastAnalysis) {
      recordWorkflowMetric('yuno_trigger_fast_path_total', 1, {
        chat_type: normalizedEvent.chatType,
        reason: fastAnalysis.reason,
      });

      recordWorkflowMetric('yuno_trigger_decisions_total', 1, {
        chat_type: normalizedEvent.chatType,
        decision: fastAnalysis.shouldRespond ? 'allow' : 'deny',
        reason: fastAnalysis.reason,
      });

      finalizeTrace(trace, {
        shouldRespond: fastAnalysis.shouldRespond,
        reason: fastAnalysis.reason,
        chatType: normalizedEvent.chatType,
        messageId: normalizedEvent.messageId,
        decisionReason: fastAnalysis.reason,
        fastPath: true,
      });

      return {
        event: normalizedEvent,
        session: {
          platform: normalizedEvent.platform,
          chatType: normalizedEvent.chatType,
          chatId: normalizedEvent.chatId,
          userId: normalizedEvent.userId,
        },
        analysis: fastAnalysis,
        trace,
      };
    }

    const context = await buildWorkflowContext(normalizedEvent, trace, deps);
    const analysis = await withTraceSpan(
      trace,
      'analyze-trigger',
      () => deps.analyzeTrigger(normalizedEvent, context, {
        ...options,
        traceContext: trace,
      }),
      {
        advancedMode: context.isAdvanced,
        chatType: normalizedEvent.chatType,
      }
    );

    recordWorkflowMetric('yuno_trigger_decisions_total', 1, {
      chat_type: normalizedEvent.chatType,
      decision: analysis.shouldRespond ? 'allow' : 'deny',
      reason: analysis.reason,
    });

    finalizeTrace(trace, {
        shouldRespond: analysis.shouldRespond,
        reason: analysis.reason,
        chatType: normalizedEvent.chatType,
        messageId: normalizedEvent.messageId,
        decisionReason: analysis.reason,
        fastPath: false,
      });

    return { ...context, analysis, trace };
  } catch (error) {
    failTrace(trace, error, {
      chatType: normalizedEvent.chatType,
      chatId: normalizedEvent.chatId,
      userId: normalizedEvent.userId,
      messageId: normalizedEvent.messageId,
    });
    throw error;
  }
}

async function runToolTask(task, context, trace, deps) {
  return withTraceSpan(trace, 'execute-tool', () => deps.toolRegistry.execute(
    task.toolName,
    task.toolArgs,
    {
      relation: context.relation,
      userState: context.userState,
      userProfile: context.userProfile,
      groupState: context.groupState,
      event: context.event,
    },
    trace
  ), { toolName: task.toolName });
}

async function persistReplyState(context, payload, trace, deps) {
  const namedTasks = [];

  namedTasks.push({
    name: 'append-conversation-messages',
    run: () => deps.appendConversationMessages(context.session, payload.nextMessages),
  });

  if (context.relation?._id) {
    namedTasks.push({
      name: 'update-relation-profile',
      run: () => deps.updateRelationProfile(context.relation, {
        text: payload.rawText,
        analysis: payload.analysis,
      }),
    });
  }

  if (context.userState?._id) {
    namedTasks.push({
      name: 'update-user-state',
      run: () => deps.updateUserState(context.userState, payload.emotionResult, payload.analysis),
    });
  }

  if (context.userProfile?._id) {
    namedTasks.push({
      name: 'update-user-profile-memory',
      run: () => deps.updateUserProfileMemory(context.userProfile, {
        text: payload.userTurn,
        analysis: payload.analysis,
        userName: payload.username,
        userId: context.event.userId,
        specialUser: context.specialUser,
      }),
    });
  }

  if (context.isAdvanced) {
    namedTasks.push({
      name: 'update-group-state',
      run: () => deps.updateGroupStateFromAnalysis({
        groupId: context.event.chatId,
        analysis: payload.analysis,
        summary: payload.summary,
      }),
    });
  }

  const results = await withTraceSpan(
    trace,
    'persist-state',
    () => Promise.allSettled(namedTasks.map((item) => item.run())),
    { taskCount: namedTasks.length }
  );

  const failures = results
    .map((item, index) => ({ name: namedTasks[index]?.name || `task-${index}`, result: item }))
    .filter((item) => item.result.status === 'rejected');
  recordWorkflowMetric('yuno_persist_failures_total', failures.length, {
    chat_type: context.event.chatType,
  });

  if (failures.length > 0) {
    const retryResults = await Promise.allSettled(
      failures.map((item) => namedTasks.find((task) => task.name === item.name)?.run?.())
    );
    const finalFailures = retryResults
      .map((result, index) => ({ result, task: failures[index]?.name }))
      .filter((item) => item.result.status === 'rejected');

    const failureDetails = finalFailures.map((item) => ({
      task: item.task,
      error: item.result.reason?.message || String(item.result.reason || 'unknown-error'),
    }));

    if (failureDetails.length === 0) {
      recordWorkflowMetric('yuno_persist_retry_recovered_total', 1, {
        chat_type: context.event.chatType,
      });
      logger.info('memory', 'Post-reply state updates recovered after retry', {
        traceId: trace.traceId,
        chatType: context.event.chatType,
        chatId: context.event.chatId,
        userId: context.event.userId,
        messageId: context.event.messageId,
        failed: failures.length,
        decisionReason: payload.analysis.reason,
      });
      return;
    }

    const firstFailureDetails = failures.map((item) => ({
      task: item.name,
      error: item.result.reason?.message || String(item.result.reason || 'unknown-error'),
    }));

    logger.warn('memory', 'Post-reply state updates partially failed', {
      traceId: trace.traceId,
      chatType: context.event.chatType,
      chatId: context.event.chatId,
      userId: context.event.userId,
      messageId: context.event.messageId,
      failed: finalFailures.length,
      decisionReason: payload.analysis.reason,
      failures: failureDetails,
      firstAttemptFailures: firstFailureDetails,
    });
  }
}

function buildPersistContextSnapshot(context) {
  return {
    session: { ...context.session },
    isAdvanced: Boolean(context.isAdvanced),
    specialUser: context.specialUser || null,
    contextMode: context.contextMode || 'full',
    relation: context.relation ? {
      _id: context.relation._id,
      platform: context.relation.platform,
      chatType: context.relation.chatType,
      chatId: context.relation.chatId,
      groupId: context.relation.groupId,
      userId: context.relation.userId,
      affection: context.relation.affection,
      tags: context.relation.tags || [],
      memorySummary: context.relation.memorySummary || '',
      preferences: context.relation.preferences || [],
      favoriteTopics: context.relation.favoriteTopics || [],
      activeScore: context.relation.activeScore || 0,
    } : null,
    userState: context.userState ? {
      _id: context.userState._id,
      platform: context.userState.platform,
      chatType: context.userState.chatType,
      chatId: context.userState.chatId,
      groupId: context.userState.groupId,
      userId: context.userState.userId,
      currentEmotion: context.userState.currentEmotion,
      intensity: context.userState.intensity,
      triggerReason: context.userState.triggerReason,
    } : null,
    userProfile: context.userProfile ? {
      _id: context.userProfile._id,
      platform: context.userProfile.platform,
      userId: context.userProfile.userId,
      profileKey: context.userProfile.profileKey,
      displayName: context.userProfile.displayName || '',
      preferredName: context.userProfile.preferredName || '',
      tonePreference: context.userProfile.tonePreference || '',
      favoriteTopics: context.userProfile.favoriteTopics || [],
      dislikes: context.userProfile.dislikes || [],
      roleplaySettings: context.userProfile.roleplaySettings || [],
      relationshipPreference: context.userProfile.relationshipPreference || '',
      personaMode: context.userProfile.personaMode || '',
      specialBondSummary: context.userProfile.specialBondSummary || '',
      bondMemories: context.userProfile.bondMemories || [],
      specialNicknames: context.userProfile.specialNicknames || [],
      profileSummary: context.userProfile.profileSummary || '',
    } : null,
  };
}

function buildPersistJobData(context, payload) {
  return {
    event: context.event,
    analysis: payload.analysis,
    emotionResult: payload.emotionResult,
    summary: payload.summary,
    username: payload.username,
    rawText: payload.rawText,
    userTurn: payload.userTurn,
    nextMessages: payload.nextMessages,
    contextSnapshot: buildPersistContextSnapshot(context),
  };
}

export async function processPersistJob(jobData, options = {}) {
  const deps = createWorkflowDeps(options.deps);
  const event = normalizeLegacyMessageEvent(jobData.event);
  const trace = createTraceContext('persist-job', {
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
    messageId: event.messageId,
    queueJobId: options.queueJobId,
  });

  try {
    const snapshot = jobData.contextSnapshot || {};
    const context = {
      event,
      session: snapshot.session || {
        platform: event.platform,
        chatType: event.chatType,
        chatId: event.chatId,
        userId: event.userId,
      },
      relation: snapshot.relation,
      userState: snapshot.userState,
      userProfile: snapshot.userProfile,
      specialUser: snapshot.specialUser || getSpecialUserByUserId(event.userId),
      isAdvanced: Boolean(snapshot.isAdvanced),
      contextMode: snapshot.contextMode || 'persist',
    };

    await persistReplyState(context, {
      nextMessages: jobData.nextMessages,
      rawText: jobData.rawText,
      userTurn: jobData.userTurn,
      analysis: jobData.analysis,
      emotionResult: jobData.emotionResult,
      summary: jobData.summary,
      username: jobData.username,
    }, trace, deps);

    recordWorkflowMetric('yuno_trigger_context_reused_total', 1, {
      chat_type: event.chatType,
      mode: 'persist-job',
    });

    finalizeTrace(trace, {
      replyType: 'persist',
      shouldRespond: true,
      queueJobId: options.queueJobId,
      messageId: event.messageId,
      contextMode: context.contextMode,
    });
    return true;
  } catch (error) {
    failTrace(trace, error, {
      queueJobId: options.queueJobId,
      messageId: event.messageId,
    });
    throw error;
  }
}

export async function processIncomingMessage(event, precomputed = null, options = {}) {
  const deps = createWorkflowDeps(options.deps);
  const normalizedEvent = normalizeLegacyMessageEvent(event);
  const trace = precomputed?.trace || options.trace || createTraceContext('incoming-message', {
    chatType: normalizedEvent.chatType,
    chatId: normalizedEvent.chatId,
    userId: normalizedEvent.userId,
    messageId: normalizedEvent.messageId,
    queueJobId: options.queueJobId,
  });

  try {
    const context = await resolveContext(normalizedEvent, precomputed, trace, deps, options);
    const workflowContext = {
      ...context,
      event: normalizedEvent,
      trace,
    };
    const rawText = normalizedEvent.rawText || '';
    const userTurn = resolveUserTurn(normalizedEvent);
    const summary = summarizeIncomingMessage(normalizedEvent.userName, rawText);
    const analysis = workflowContext.analysis;

    if (!analysis.shouldRespond) {
      logger.info('analysis', 'Message skipped after analysis', {
        traceId: trace.traceId,
        chatType: normalizedEvent.chatType,
        chatId: normalizedEvent.chatId,
        userId: normalizedEvent.userId,
        messageId: normalizedEvent.messageId,
        reason: analysis.reason,
        confidence: analysis.confidence,
        decisionReason: analysis.reason,
      });
      finalizeTrace(trace, {
        shouldRespond: false,
        reason: analysis.reason,
        queueJobId: options.queueJobId,
      });
      return null;
    }

    let task = deps.planIncomingTask({
      event: normalizedEvent,
      text: rawText,
      analysis,
      conversationState: workflowContext.conversationState,
    });

    if (task.type === 'tool') {
      try {
        const toolResult = await runToolTask(task, workflowContext, trace, deps);
        const target = {
          platform: normalizedEvent.platform,
          chatType: normalizedEvent.chatType,
          chatId: normalizedEvent.chatId,
        };

        let replyText = toolResult?.text || toolResult?.summary || '已经处理好了。';
        if (toolResult?.tool) {
          const policy = resolveUserPersonaPolicy({
            userId: normalizedEvent.userId,
            scene: normalizedEvent.chatType,
            relation: workflowContext.relation,
            basePersona: 'yuno',
          });
          replyText = formatToolResultAsYuno(toolResult, policy);
          const outputs = normalizeFormatterOutputs(toolResult, replyText);
          await withTraceSpan(trace, 'send-tool-response', () => deps.sendStructuredReply(target, outputs), {
            toolName: task.toolName,
          });
          recordWorkflowMetric('yuno_tool_results_total', 1, {
            tool: task.toolName,
            chat_type: normalizedEvent.chatType,
          });
        } else {
          await withTraceSpan(trace, 'send-tool-response', () => deps.sendReply(target, replyText), {
            toolName: task.toolName,
          });
        }

        finalizeTrace(trace, {
          replyType: 'tool',
          toolName: task.toolName,
          shouldRespond: true,
          route: task.category,
          queueJobId: options.queueJobId,
          messageId: normalizedEvent.messageId,
        });
        return replyText;
      } catch (error) {
        logger.warn('tool', 'Tool execution fell back to chat response', {
          traceId: trace.traceId,
          toolName: task.toolName,
          messageId: normalizedEvent.messageId,
          message: error.message,
        });
        task = {
          ...task,
          type: 'chat',
          category: 'knowledge_qa',
          requiresModel: true,
          requiresRetrieval: true,
          allowFollowUp: normalizedEvent.chatType === 'private',
          reason: 'tool-fallback',
        };
        analysis.reason = 'tool-fallback';
      }
    }

    const knowledge = task.requiresRetrieval
      ? await withTraceSpan(trace, 'retrieve-knowledge', () => deps.retrieveKnowledge(userTurn, {
          reason: task.reason,
          preferredTags: getSpecialUserKnowledgeTags(workflowContext.specialUser),
        }), {
          route: task.category,
        })
      : { enabled: false, documents: [], reason: 'route-does-not-require-retrieval' };

    const emotionResult = deps.resolveEmotion({
      relation: workflowContext.relation,
      userState: workflowContext.userState,
      groupState: workflowContext.groupState,
      messageAnalysis: analysis,
      isAdmin: workflowContext.isAdmin,
      specialUser: workflowContext.specialUser,
    });
    const replyLengthProfile = resolveReplyLengthProfile({
      event: normalizedEvent,
      route: task,
      analysis,
      emotionResult,
      conversationState: workflowContext.conversationState,
    });
    const replyPlan = resolveReplyIntentPlan({
      event: normalizedEvent,
      route: task,
      analysis,
      conversationState: workflowContext.conversationState,
    });

    const throttleState = consumeGroupReplyThrottle(normalizedEvent, task);
    if (throttleState.throttled) {
      const throttledReply = shapeChatReplyText(throttleState.hint, emotionResult);
      await withTraceSpan(trace, 'send-text-throttled', () => deps.sendReply({
        platform: normalizedEvent.platform,
        chatType: normalizedEvent.chatType,
        chatId: normalizedEvent.chatId,
      }, throttledReply));

      recordWorkflowMetric('yuno_group_reply_throttled_total', 1, {
        chat_type: normalizedEvent.chatType,
        route: task.category,
      });

      finalizeTrace(trace, {
        replyType: 'chat-throttled',
        shouldRespond: true,
        route: task.category,
        queueJobId: options.queueJobId,
        messageId: normalizedEvent.messageId,
        decisionReason: 'group-reply-throttle',
      });
      return throttledReply;
    }

    const systemPrompt = await withTraceSpan(trace, 'build-prompt', () => Promise.resolve(deps.buildReplyContext({
      event: normalizedEvent,
      route: task,
      relation: workflowContext.relation,
      userState: workflowContext.userState,
      userProfile: workflowContext.userProfile,
      conversationState: workflowContext.conversationState,
      groupState: workflowContext.groupState,
      recentEvents: workflowContext.recentEvents,
      messageAnalysis: analysis,
      emotionResult,
      knowledge,
      isAdmin: workflowContext.isAdmin,
      specialUser: workflowContext.specialUser,
      replyLengthProfile,
      replyPlan,
    })), {
      route: task.category,
      promptProfile: replyLengthProfile.promptProfile,
      performanceProfile: replyLengthProfile.performanceProfile,
      replyPlanType: replyPlan.type,
    });

    let visibleReplyText = '';
    try {
      const rawReplyText = await withTraceSpan(trace, 'generate-reply', () => deps.chat(
        (workflowContext.conversationState.messages || []).map((item) => ({
          role: item.role,
          content: item.content,
        })),
        systemPrompt,
        userTurn,
        {
          traceContext: trace,
          promptVersion: 'reply-context/v6',
          operation: 'reply',
          maxTokens: replyLengthProfile.maxTokens,
          historyLimit: replyLengthProfile.historyLimit,
          temperature: replyLengthProfile.temperature,
        }
      ), {
        historySize: workflowContext.conversationState.messages.length,
        route: task.category,
        advancedMode: workflowContext.isAdvanced,
        replyLengthTier: replyLengthProfile.tier,
        replyPerformanceProfile: replyLengthProfile.performanceProfile,
        replyMaxTokens: replyLengthProfile.maxTokens,
        replyHistoryLimit: replyLengthProfile.historyLimit,
        replyTemperature: replyLengthProfile.temperature,
        promptProfile: replyLengthProfile.promptProfile,
      });

      visibleReplyText = stripHiddenReasoning(rawReplyText) || '刚才那句被我吞掉了，你再说一遍。';
      if (visibleReplyText !== String(rawReplyText || '').trim()) {
        recordWorkflowMetric('yuno_hidden_reasoning_stripped_total', 1, {
          chat_type: normalizedEvent.chatType,
          route: task.category,
        });
        logger.info('model', 'Hidden reasoning was stripped from reply output', {
          traceId: trace.traceId,
          chatType: normalizedEvent.chatType,
          chatId: normalizedEvent.chatId,
          userId: normalizedEvent.userId,
          messageId: normalizedEvent.messageId,
          route: task.category,
        });
      }
    } catch (error) {
      if (!isModelUnavailableError(error)) {
        throw error;
      }

      recordWorkflowMetric('yuno_model_fallback_total', 1, {
        chat_type: normalizedEvent.chatType,
        route: task.category,
        reason: String(error.code || error.status || 'model-unavailable').toLowerCase(),
      });
      logger.warn('model', 'Reply generation fell back to canned response', {
        traceId: trace.traceId,
        chatType: normalizedEvent.chatType,
        chatId: normalizedEvent.chatId,
        userId: normalizedEvent.userId,
        messageId: normalizedEvent.messageId,
        route: task.category,
        code: error.code,
        status: error.status || error.response?.status,
        message: error.message,
      });
      visibleReplyText = buildModelFallbackReply(normalizedEvent, task, error);
    }

    const replyText = shapeChatReplyText(visibleReplyText, emotionResult);
    const nextMessages = [
      { role: 'user', content: userTurn },
      { role: 'assistant', content: replyText },
    ];

    await withTraceSpan(trace, 'send-text', () => deps.sendReply({
      platform: normalizedEvent.platform,
      chatType: normalizedEvent.chatType,
      chatId: normalizedEvent.chatId,
    }, replyText));

    const persistJobData = buildPersistJobData(workflowContext, {
      nextMessages,
      rawText,
      userTurn,
      analysis,
      emotionResult,
      summary,
      username: normalizedEvent.userName,
    });

    if (!options.persistInline && deps.enqueuePersistJob) {
      await deps.enqueuePersistJob(persistJobData, {
        jobId: `persist:${normalizedEvent.platform}:${normalizedEvent.chatId}:${normalizedEvent.messageId || Date.now()}`,
      });
    } else {
      await persistReplyState(workflowContext, {
        nextMessages,
        rawText,
        userTurn,
        analysis,
        emotionResult,
        summary,
        username: normalizedEvent.userName,
      }, trace, deps);
    }

    if (config.enableVoice && config.yunoVoiceUri && deps.shouldSendVoiceForEmotion(emotionResult)) {
      try {
        const audio = await withTraceSpan(trace, 'tts', () => deps.tts(replyText, {
          traceContext: trace,
          operation: 'tts',
        }));
        await withTraceSpan(trace, 'send-voice', () => deps.sendVoice({
          platform: normalizedEvent.platform,
          chatType: normalizedEvent.chatType,
          chatId: normalizedEvent.chatId,
        }, audio));
      } catch (error) {
        logger.warn('model', 'Voice generation skipped', {
          traceId: trace.traceId,
          chatId: normalizedEvent.chatId,
          messageId: normalizedEvent.messageId,
          message: error.message,
        });
      }
    }

    recordWorkflowMetric('yuno_replies_sent_total', 1, {
      chat_type: normalizedEvent.chatType,
      route: task.category,
    });

    finalizeTrace(trace, {
      replyType: 'chat',
      shouldRespond: true,
      route: task.category,
      knowledgeHits: knowledge.documents?.length || 0,
      queueJobId: options.queueJobId,
      messageId: normalizedEvent.messageId,
      decisionReason: analysis.reason,
      contextMode: workflowContext.contextMode || 'full',
      replyLengthTier: replyLengthProfile.tier,
      replyPerformanceProfile: replyLengthProfile.performanceProfile,
      replyMaxTokens: replyLengthProfile.maxTokens,
      replyPlanType: replyPlan.type,
      replyPlanDepth: replyPlan.depth,
      replyPlanQuestionNeeded: replyPlan.questionNeeded,
    });
    return replyText;
  } catch (error) {
    failTrace(trace, error, {
      chatType: normalizedEvent.chatType,
      chatId: normalizedEvent.chatId,
      userId: normalizedEvent.userId,
      messageId: normalizedEvent.messageId,
      queueJobId: options.queueJobId,
    });
    throw error;
  }
}

export async function processReplyJob(jobData, options = {}) {
  return processIncomingMessage(jobData.event, {
    analysis: jobData.analysis,
  }, {
    ...options,
    queueJobId: options.queueJobId,
    persistInline: false,
  });
}

export async function processGroupMessage(event, precomputed = null, options = {}) {
  return processIncomingMessage(event, precomputed, options);
}






