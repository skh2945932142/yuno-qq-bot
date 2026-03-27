import { config } from './config.js';
import { logger } from './logger.js';
import { chat, tts } from './minimax.js';
import { sendReply, sendStructuredReply, sendVoice } from './sender.js';
import { analyzeTrigger } from './message-analysis.js';
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

registerQueryTools(toolRegistry);

const ALLOWED_SOFT_EMOJIS = new Set(['\u2764', '\u2665', '\u{1F495}', '\u{1F49E}', '\u2728']);
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

  if ((event.attachments || []).some((item) => item.type === 'face')) return `[${event.userName} sent a sticker]`;
  if ((event.attachments || []).some((item) => item.type === 'image')) return `[${event.userName} sent an image]`;
  if ((event.attachments || []).some((item) => item.type === 'record')) return `[${event.userName} sent a voice message]`;
  if ((event.attachments || []).some((item) => item.type === 'video')) return `[${event.userName} sent a video]`;
  if ((event.attachments || []).length > 0) return `[${event.userName} sent a message]`;

  return cleanText;
}

function createWorkflowDeps(deps = {}) {
  const runtimeServices = getRuntimeServices();

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
    sendStructuredReply: deps.sendStructuredReply || sendStructuredReply,
    sendVoice: deps.sendVoice || sendVoice,
    toolRegistry: deps.toolRegistry || toolRegistry,
    enqueuePersistJob: deps.enqueuePersistJob || runtimeServices.queueManager?.enqueuePersist || null,
  };
}

export async function buildWorkflowContext(event, trace, deps) {
  const session = {
    platform: event.platform,
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
  };
  const isAdvanced = event.chatType === 'group' && canUseAdvancedGroupFeatures(event.chatId);
  const specialUser = getSpecialUserByUserId(event.userId);

  const [relation, userState, userProfile, conversationState, groupState, recentEvents] = await withTraceSpan(
    trace,
    'load-context',
    () => Promise.all([
      deps.ensureRelation(session),
      deps.ensureUserState(session),
      deps.ensureUserProfileMemory({ platform: event.platform, userId: event.userId, userName: event.userName, specialUser }),
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
    specialUser,
    isAdmin: event.userId === config.adminQq,
    isAdvanced,
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

  const context = await buildWorkflowContext(event, trace, deps);
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
  const tasks = [
    deps.appendConversationMessages(context.session, payload.nextMessages),
    deps.updateRelationProfile(context.relation, { text: payload.rawText, analysis: payload.analysis }),
    deps.updateUserState(context.userState, payload.emotionResult, payload.analysis),
    deps.updateUserProfileMemory(context.userProfile, {
      text: payload.userTurn,
      analysis: payload.analysis,
      userName: payload.username,
      userId: context.event.userId,
      specialUser: context.specialUser,
    }),
  ];


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
  recordWorkflowMetric('yuno_persist_failures_total', failures.length, {
    chat_type: context.event.chatType,
  });

  if (failures.length > 0) {
    logger.warn('memory', 'Post-reply state updates partially failed', {
      traceId: trace.traceId,
      chatType: context.event.chatType,
      chatId: context.event.chatId,
      userId: context.event.userId,
      messageId: context.event.messageId,
      failed: failures.length,
      decisionReason: payload.analysis.reason,
    });
  }
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
    const context = await buildWorkflowContext(event, trace, deps);
    await persistReplyState(context, {
      nextMessages: jobData.nextMessages,
      rawText: jobData.rawText,
      userTurn: jobData.userTurn,
      analysis: jobData.analysis,
      emotionResult: jobData.emotionResult,
      summary: jobData.summary,
      username: jobData.username,
    }, trace, deps);

    finalizeTrace(trace, {
      replyType: 'persist',
      shouldRespond: true,
      queueJobId: options.queueJobId,
      messageId: event.messageId,
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

        let replyText = toolResult?.text || toolResult?.summary || 'Done.';
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
      specialUser: workflowContext.specialUser,
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
        promptVersion: 'reply-context/v4',
        operation: 'reply',
      }
    ), {
      historySize: workflowContext.conversationState.messages.length,
      route: task.category,
      advancedMode: workflowContext.isAdvanced,
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





