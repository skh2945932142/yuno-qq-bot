import { config, isAdvancedGroup } from './config.js';
import { logger } from './logger.js';
import { chat, tts } from './minimax.js';
import { sendReply, sendVoice } from './sender.js';
import { analyzeTrigger } from './message-analysis.js';
import { resolveEmotion, shouldSendVoiceForEmotion } from './services/emotion-engine.js';
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
import { createTraceContext, failTrace, finalizeTrace, withTraceSpan } from './observability/tracing.js';
import { planIncomingTask } from './task-router.js';
import { registerQueryTools } from './query-tools.js';
import { toolRegistry } from './tools/registry.js';
import { normalizeLegacyMessageEvent } from './chat/session.js';
import { stripCqCodes } from './utils.js';

registerQueryTools(toolRegistry);

const ALLOWED_SOFT_EMOJIS = new Set(['❤', '♥', '💕', '💞', '✨']);
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

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

function resolveUserTurn(event) {
  const cleanText = stripCqCodes(event.rawText || event.text || '');
  if (cleanText) return cleanText;

  if ((event.attachments || []).some((item) => item.type === 'face')) return `[${event.userName} 发送了一个表情]`;
  if ((event.attachments || []).some((item) => item.type === 'image')) return `[${event.userName} 发送了一张图片]`;
  if ((event.attachments || []).some((item) => item.type === 'record')) return `[${event.userName} 发送了一条语音]`;
  if ((event.attachments || []).some((item) => item.type === 'video')) return `[${event.userName} 发送了一段视频]`;
  if ((event.attachments || []).length > 0) return `[${event.userName} 发送了一条消息]`;

  return cleanText;
}

function createWorkflowDeps(deps = {}) {
  return {
    analyzeTrigger: deps.analyzeTrigger || analyzeTrigger,
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
    sendVoice: deps.sendVoice || sendVoice,
    toolRegistry: deps.toolRegistry || toolRegistry,
  };
}

async function buildContext(event, trace, deps) {
  const session = {
    platform: event.platform,
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
  };
  const isAdvanced = event.chatType === 'group' && canUseAdvancedGroupFeatures(event.chatId);

  const [relation, userState, userProfile, conversationState, groupState, recentEvents] = await withTraceSpan(
    trace,
    'load-context',
    () => Promise.all([
      deps.ensureRelation(session),
      deps.ensureUserState(session),
      deps.ensureUserProfileMemory({ platform: event.platform, userId: event.userId, userName: event.userName }),
      deps.getConversationState(session),
      isAdvanced ? deps.ensureGroupState(event.chatId) : Promise.resolve(null),
      isAdvanced ? deps.getRecentEvents(event.chatId, 5) : Promise.resolve([]),
    ]),
    {
      chatType: event.chatType,
      chatId: event.chatId,
      userId: event.userId,
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
    isAdmin: event.userId === config.adminQq,
    isAdvanced,
  };
}

export async function shouldRespondToEvent(event, options = {}) {
  const deps = createWorkflowDeps(options.deps);
  const normalizedEvent = normalizeLegacyMessageEvent(event);
  const trace = options.trace || createTraceContext('should-respond', {
    chatType: normalizedEvent.chatType,
    chatId: normalizedEvent.chatId,
    userId: normalizedEvent.userId,
  });

  try {
    const context = await buildContext(normalizedEvent, trace, deps);
    const analysis = await withTraceSpan(
      trace,
      'analyze-trigger',
      () => deps.analyzeTrigger(normalizedEvent, context, options),
      {
        advancedMode: context.isAdvanced,
        chatType: normalizedEvent.chatType,
      }
    );

    finalizeTrace(trace, {
      shouldRespond: analysis.shouldRespond,
      reason: analysis.reason,
      chatType: normalizedEvent.chatType,
    });

    return { ...context, analysis, trace };
  } catch (error) {
    failTrace(trace, error);
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
  const tasks = [
    deps.appendConversationMessages(context.session, payload.nextMessages),
    deps.updateRelationProfile(context.relation, { text: payload.rawText, analysis: payload.analysis }),
    deps.updateUserState(context.userState, payload.emotionResult, payload.analysis),
    deps.updateUserProfileMemory(context.userProfile, {
      text: payload.userTurn,
      analysis: payload.analysis,
      userName: payload.username,
    }),
  ];

  if (payload.summary && context.event.chatType === 'group') {
    tasks.push(deps.recordGroupEvent({
      groupId: context.event.chatId,
      userId: context.event.userId,
      username: payload.username,
      summary: payload.summary,
      sentiment: payload.analysis.sentiment,
      topics: payload.analysis.topics,
    }));
  }

  if (context.isAdvanced) {
    tasks.push(deps.updateGroupStateFromAnalysis({
      groupId: context.event.chatId,
      analysis: payload.analysis,
      summary: payload.summary,
    }));
  }

  const results = await withTraceSpan(trace, 'persist-state', () => Promise.allSettled(tasks), {
    taskCount: tasks.length,
  });

  const failures = results.filter((item) => item.status === 'rejected');
  if (failures.length > 0) {
    logger.warn('memory', 'Post-reply state updates partially failed', {
      chatType: context.event.chatType,
      chatId: context.event.chatId,
      userId: context.event.userId,
      failed: failures.length,
      traceId: trace.traceId,
    });
  }
}

export async function processIncomingMessage(event, precomputed = null, options = {}) {
  const deps = createWorkflowDeps(options.deps);
  const normalizedEvent = normalizeLegacyMessageEvent(event);
  const trace = precomputed?.trace || options.trace || createTraceContext('incoming-message', {
    chatType: normalizedEvent.chatType,
    chatId: normalizedEvent.chatId,
    userId: normalizedEvent.userId,
  });

  try {
    const context = precomputed || await shouldRespondToEvent(normalizedEvent, { ...options, trace, deps });
    const workflowContext = {
      ...context,
      event: normalizedEvent,
      session: context.session || {
        platform: normalizedEvent.platform,
        chatType: normalizedEvent.chatType,
        chatId: normalizedEvent.chatId,
        userId: normalizedEvent.userId,
      },
    };
    const rawText = normalizedEvent.rawText || '';
    const userTurn = resolveUserTurn(normalizedEvent);
    const summary = summarizeIncomingMessage(normalizedEvent.userName, rawText);
    const analysis = workflowContext.analysis;

    if (!analysis.shouldRespond) {
      logger.info('analysis', 'Message skipped after analysis', {
        chatType: normalizedEvent.chatType,
        chatId: normalizedEvent.chatId,
        userId: normalizedEvent.userId,
        reason: analysis.reason,
        confidence: analysis.confidence,
        traceId: trace.traceId,
      });
      finalizeTrace(trace, {
        shouldRespond: false,
        reason: analysis.reason,
      });
      return null;
    }

    const task = deps.planIncomingTask({
      event: normalizedEvent,
      text: rawText,
      analysis,
      conversationState: workflowContext.conversationState,
    });

    if (task.type === 'tool') {
      const toolResult = await runToolTask(task, workflowContext, trace, deps);
      await withTraceSpan(trace, 'send-tool-response', () => deps.sendReply({
        platform: normalizedEvent.platform,
        chatType: normalizedEvent.chatType,
        chatId: normalizedEvent.chatId,
      }, toolResult.text), {
        toolName: task.toolName,
      });
      finalizeTrace(trace, {
        replyType: 'tool',
        toolName: task.toolName,
        shouldRespond: true,
      });
      return toolResult.text;
    }

    const knowledge = task.requiresRetrieval
      ? await withTraceSpan(trace, 'retrieve-knowledge', () => deps.retrieveKnowledge(userTurn, {
          reason: task.reason,
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
    });

    const systemPrompt = deps.buildReplyContext({
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
    });

    const rawReplyText = await withTraceSpan(trace, 'generate-reply', () => deps.chat(
      (workflowContext.conversationState.messages || []).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      systemPrompt,
      userTurn,
      {
        traceContext: trace,
        promptVersion: 'reply-context/v3',
        operation: 'reply',
      }
    ), {
      historySize: workflowContext.conversationState.messages.length,
      route: task.category,
      advancedMode: isAdvancedGroup(normalizedEvent.chatId),
    });

    const replyText = enforceEmojiBudget(rawReplyText, emotionResult);
    const nextMessages = [
      { role: 'user', content: userTurn },
      { role: 'assistant', content: replyText },
    ];

    await withTraceSpan(trace, 'send-text', () => deps.sendReply({
      platform: normalizedEvent.platform,
      chatType: normalizedEvent.chatType,
      chatId: normalizedEvent.chatId,
    }, replyText));

    await persistReplyState(workflowContext, {
      nextMessages,
      rawText,
      userTurn,
      analysis,
      emotionResult,
      summary,
      username: normalizedEvent.userName,
    }, trace, deps);

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
          message: error.message,
          traceId: trace.traceId,
        });
      }
    }

    finalizeTrace(trace, {
      replyType: 'chat',
      shouldRespond: true,
      route: task.category,
      knowledgeHits: knowledge.documents?.length || 0,
    });
    return replyText;
  } catch (error) {
    failTrace(trace, error, {
      chatType: normalizedEvent.chatType,
      chatId: normalizedEvent.chatId,
      userId: normalizedEvent.userId,
    });
    throw error;
  }
}

export async function processGroupMessage(event, precomputed = null, options = {}) {
  return processIncomingMessage(event, precomputed, options);
}
