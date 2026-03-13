import { config, isAdvancedGroup } from '../config.js';
import { logger } from '../logger.js';
import { chat, tts } from '../minimax.js';
import { sendText, sendVoice } from '../sender.js';
import { analyzeTrigger } from '../services/analysis.js';
import { resolveEmotion, shouldSendVoiceForEmotion } from '../services/emotion-engine.js';
import {
  canUseAdvancedGroupFeatures,
  ensureGroupState,
  getRecentEvents,
  recordGroupEvent,
  updateGroupStateFromAnalysis,
} from '../state/group-state.js';
import {
  ensureRelation,
  ensureUserState,
  getHistory,
  saveHistory,
  updateRelationProfile,
  updateUserState,
} from '../memory/index.js';
import { buildReplyContext } from '../prompts/index.js';
import { createTraceContext, failTrace, finalizeTrace, withTraceSpan } from '../observability/tracing.js';
import { planIncomingTask } from '../agents/task-router.js';
import { registerQueryTools } from '../tools/query-tools.js';
import { toolRegistry } from '../tools/registry.js';
import { stripCqCodes } from '../utils.js';
import { parseCommand } from '../services/commands.js';

registerQueryTools(toolRegistry);

function summarizeIncomingMessage(username, text) {
  const cleaned = stripCqCodes(text).slice(0, 80);
  if (!cleaned) return '';
  return `${username}: ${cleaned}`;
}

async function buildContext(event, trace) {
  const groupId = String(event.group_id);
  const userId = String(event.user_id);

  const [relation, userState, groupState] = await withTraceSpan(trace, 'load-context', () => Promise.all([
    ensureRelation(groupId, userId),
    ensureUserState(groupId, userId),
    canUseAdvancedGroupFeatures(groupId) ? ensureGroupState(groupId) : Promise.resolve(null),
  ]), { groupId, userId });

  return {
    groupId,
    userId,
    relation,
    userState,
    groupState,
    isAdmin: userId === config.adminQq,
    isAdvanced: isAdvancedGroup(groupId),
  };
}

export async function shouldRespondToEvent(event, options = {}) {
  const trace = options.trace || createTraceContext('should-respond', {
    groupId: String(event.group_id || ''),
    userId: String(event.user_id || ''),
  });

  try {
    const context = await buildContext(event, trace);
    const command = parseCommand(event.raw_message || '');
    const analysis = command
      ? {
          shouldRespond: true,
          confidence: 1,
          intent: 'query',
          sentiment: 'neutral',
          relevance: 1,
          reason: 'deterministic-command',
          topics: [],
          ruleSignals: ['command'],
          replyStyle: 'calm',
        }
      : await withTraceSpan(trace, 'analyze-trigger', () => analyzeTrigger(event, context), {
          advancedMode: context.isAdvanced,
        });
    finalizeTrace(trace, {
      shouldRespond: analysis.shouldRespond,
      reason: analysis.reason,
    });
    return { ...context, analysis, trace };
  } catch (error) {
    failTrace(trace, error);
    throw error;
  }
}

async function runToolTask(task, context, trace) {
  return withTraceSpan(trace, 'execute-tool', () => toolRegistry.execute(
    task.toolName,
    task.toolArgs,
    {
      relation: context.relation,
      userState: context.userState,
      groupState: context.groupState,
      event: context.event,
    },
    trace
  ), { toolName: task.toolName });
}

async function persistReplyState(context, payload, trace) {
  const tasks = [
    saveHistory(context.groupId, context.userId, payload.nextMessages),
    updateRelationProfile(context.relation, { text: payload.rawText, analysis: payload.analysis }),
    updateUserState(context.userState, payload.emotionResult, payload.analysis),
  ];

  if (payload.summary) {
    tasks.push(recordGroupEvent({
      groupId: context.groupId,
      userId: context.userId,
      username: payload.username,
      summary: payload.summary,
      sentiment: payload.analysis.sentiment,
      topics: payload.analysis.topics,
    }));
  }

  if (context.isAdvanced) {
    tasks.push(updateGroupStateFromAnalysis({
      groupId: context.groupId,
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
      groupId: context.groupId,
      userId: context.userId,
      failed: failures.length,
      traceId: trace.traceId,
    });
  }
}

export async function processGroupMessage(event, precomputed = null, options = {}) {
  const trace = precomputed?.trace || options.trace || createTraceContext('group-message', {
    groupId: String(event.group_id || ''),
    userId: String(event.user_id || ''),
  });

  try {
    const context = precomputed || await shouldRespondToEvent(event, { trace });
    const workflowContext = { ...context, event };
    const { groupId, userId, relation, userState } = workflowContext;
    const username = event.sender?.nickname || event.sender?.card || 'user';
    const rawText = event.raw_message || '';
    const cleanText = stripCqCodes(rawText);
    const summary = summarizeIncomingMessage(username, rawText);
    const analysis = workflowContext.analysis;

    if (!analysis.shouldRespond) {
      logger.info('analysis', 'Message skipped after analysis', {
        groupId,
        userId,
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

    const task = planIncomingTask({ text: rawText, analysis });
    if (task.type === 'tool') {
      const toolResult = await runToolTask(task, workflowContext, trace);
      await withTraceSpan(trace, 'send-tool-response', () => sendText(groupId, toolResult.text), {
        toolName: task.toolName,
      });
      finalizeTrace(trace, {
        replyType: 'tool',
        toolName: task.toolName,
        shouldRespond: true,
      });
      return toolResult.text;
    }

    const [history, recentEvents] = await withTraceSpan(trace, 'load-history', () => Promise.all([
      getHistory(groupId, userId),
      workflowContext.isAdvanced ? getRecentEvents(groupId, 5) : Promise.resolve([]),
    ]), {
      advancedMode: workflowContext.isAdvanced,
    });

    const emotionResult = resolveEmotion({
      relation,
      userState,
      groupState: workflowContext.groupState,
      messageAnalysis: analysis,
      isAdmin: workflowContext.isAdmin,
    });

    const systemPrompt = buildReplyContext({
      relation,
      userState,
      groupState: workflowContext.groupState,
      history,
      recentEvents,
      username,
      messageAnalysis: analysis,
      emotionResult,
      isAdmin: workflowContext.isAdmin,
      advancedMode: workflowContext.isAdvanced,
    });

    const replyText = await withTraceSpan(trace, 'generate-reply', () => chat(
      history.map((item) => ({ role: item.role, content: item.content })),
      systemPrompt,
      cleanText,
      {
        traceContext: trace,
        promptVersion: 'reply-context/v2',
        operation: 'reply',
      }
    ), {
      historySize: history.length,
    });

    const nextMessages = [
      ...history,
      { role: 'user', content: cleanText },
      { role: 'assistant', content: replyText },
    ].slice(-40);

    await withTraceSpan(trace, 'send-text', () => sendText(groupId, replyText));
    await persistReplyState(workflowContext, {
      nextMessages,
      rawText,
      analysis,
      emotionResult,
      summary,
      username,
    }, trace);

    if (config.enableVoice && config.yunoVoiceUri && shouldSendVoiceForEmotion(emotionResult)) {
      try {
        const audio = await withTraceSpan(trace, 'tts', () => tts(replyText, {
          traceContext: trace,
          operation: 'tts',
        }));
        await withTraceSpan(trace, 'send-voice', () => sendVoice(groupId, audio));
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
      usedAdvancedAnalysis: analysis.reason === 'llm-analysis',
    });
    return replyText;
  } catch (error) {
    failTrace(trace, error, {
      groupId: String(event.group_id || ''),
      userId: String(event.user_id || ''),
    });
    throw error;
  }
}
