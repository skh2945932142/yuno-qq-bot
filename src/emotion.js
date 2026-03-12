import { config, isAdvancedGroup } from './config.js';
import { logger } from './logger.js';
import { chat, tts } from './minimax.js';
import { sendText, sendVoice } from './sender.js';
import { buildCommandResponse, parseCommand } from './services/commands.js';
import { analyzeTrigger } from './services/analysis.js';
import { resolveEmotion, shouldSendVoiceForEmotion } from './services/emotion-engine.js';
import {
  canUseAdvancedGroupFeatures,
  ensureGroupState,
  getRecentEvents,
  recordGroupEvent,
  updateGroupStateFromAnalysis,
} from './services/group-state.js';
import {
  ensureRelation,
  ensureUserState,
  getHistory,
  saveHistory,
  updateRelationProfile,
  updateUserState,
} from './services/memory-service.js';
import { buildReplyContext } from './services/prompt.js';
import { stripCqCodes } from './utils.js';

function summarizeIncomingMessage(username, text) {
  const cleaned = stripCqCodes(text).slice(0, 80);
  if (!cleaned) return '';
  return `${username}: ${cleaned}`;
}

async function buildContext(event) {
  const groupId = String(event.group_id);
  const userId = String(event.user_id);
  const relation = await ensureRelation(groupId, userId);
  const userState = await ensureUserState(groupId, userId);
  const groupState = canUseAdvancedGroupFeatures(groupId)
    ? await ensureGroupState(groupId)
    : null;

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

export async function shouldRespond(event) {
  const context = await buildContext(event);
  const analysis = await analyzeTrigger(event, context);
  return { ...context, analysis };
}

export async function handleMessage(event, precomputed = null) {
  const context = precomputed || await shouldRespond(event);
  const { groupId, userId, relation, userState } = context;
  const username = event.sender?.nickname || event.sender?.card || '陌生人';
  const text = event.raw_message || '';
  const analysis = context.analysis;

  if (!analysis.shouldRespond) {
    logger.info('analysis', 'Message skipped after analysis', {
      groupId,
      userId,
      reason: analysis.reason,
      confidence: analysis.confidence,
    });
    return null;
  }

  const summary = summarizeIncomingMessage(username, text);
  if (summary) {
    await recordGroupEvent({
      groupId,
      userId,
      username,
      summary,
      sentiment: analysis.sentiment,
      topics: analysis.topics,
    });
  }

  const groupState = context.isAdvanced
    ? await updateGroupStateFromAnalysis({ groupId, analysis, summary })
    : context.groupState;
  const recentEvents = context.isAdvanced ? await getRecentEvents(groupId, 5) : [];

  const command = parseCommand(text);
  if (command) {
    const commandText = buildCommandResponse(command, {
      relation,
      userState,
      groupState,
    });

    if (commandText) {
      await sendText(groupId, commandText);
      return commandText;
    }
  }

  const history = await getHistory(groupId, userId);
  const emotionResult = resolveEmotion({
    relation,
    userState,
    groupState,
    messageAnalysis: analysis,
    isAdmin: context.isAdmin,
  });

  const systemPrompt = buildReplyContext({
    relation,
    userState,
    groupState,
    history,
    recentEvents,
    username,
    messageAnalysis: analysis,
    emotionResult,
    isAdmin: context.isAdmin,
    advancedMode: context.isAdvanced,
  });

  const replyText = await chat(
    history.map((item) => ({ role: item.role, content: item.content })),
    systemPrompt,
    stripCqCodes(text)
  );

  const nextMessages = [
    ...history,
    { role: 'user', content: stripCqCodes(text) },
    { role: 'assistant', content: replyText },
  ].slice(-40);

  await saveHistory(groupId, userId, nextMessages);
  await updateRelationProfile(relation, { text, analysis });
  await updateUserState(userState, emotionResult, analysis);

  await sendText(groupId, replyText);

  if (config.yunoVoiceUri && shouldSendVoiceForEmotion(emotionResult)) {
    try {
      const audio = await tts(replyText);
      await sendVoice(groupId, audio);
    } catch (error) {
      logger.warn('model', 'Voice generation skipped', { message: error.message });
    }
  }

  return replyText;
}
