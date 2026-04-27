import {
  buildWorkflowContext,
  processIncomingMessage,
  shouldRespondToEvent,
} from './message-workflow.js';
import { normalizeLegacyMessageEvent } from './chat/session.js';
import { createTraceContext } from './runtime-tracing.js';
import { sendReply, sendStructuredReply, sendVoice } from './sender.js';
import { resolveUserPersonaPolicy } from './persona-policy.js';
import {
  formatToolResultAsYuno,
  normalizeFormatterOutputs,
} from './yuno-formatter.js';

function normalizeScene(scene) {
  return String(scene || 'group').trim().toLowerCase() === 'private' ? 'private' : 'group';
}

function normalizePluginRoute(pluginRoute, event) {
  if (!pluginRoute) {
    return null;
  }

  if (typeof pluginRoute === 'object') {
    return pluginRoute;
  }

  const category = String(pluginRoute).trim() || (event.chatType === 'private' ? 'private_chat' : 'group_chat');
  return {
    type: 'chat',
    category,
    requiresModel: true,
    requiresRetrieval: category === 'knowledge_qa',
    allowFollowUp: event.chatType === 'private',
    reason: `plugin-route:${category}`,
  };
}

export function buildYunoCoreEvent({
  platform = 'qq',
  scene = 'group',
  userId,
  groupId = '',
  chatId = '',
  username = '',
  rawMessage = '',
  metadata = {},
}) {
  const chatType = normalizeScene(scene || metadata.chatType);
  const resolvedChatId = String(chatId || (chatType === 'group' ? groupId : userId) || '').trim();

  return normalizeLegacyMessageEvent({
    platform,
    chatType,
    chatId: resolvedChatId,
    userId: String(userId || '').trim(),
    userName: username || metadata.userName || String(userId || '').trim() || 'user',
    messageId: metadata.messageId || '',
    replyTo: metadata.replyTo || '',
    rawText: String(rawMessage || ''),
    text: metadata.text || String(rawMessage || ''),
    mentionsBot: Boolean(metadata.mentionsBot),
    attachments: Array.isArray(metadata.attachments) ? metadata.attachments : [],
    timestamp: Number.isFinite(metadata.timestamp) ? metadata.timestamp : Date.now(),
    source: {
      adapter: metadata.adapter || platform,
      ...metadata.source,
    },
    selfId: metadata.selfId || '',
    sender: metadata.sender || {},
  });
}

function createOutputCollector() {
  return {
    replies: [],
    voices: [],
    outputs: [],
  };
}

function appendStructuredOutputs(output, target, outputs = []) {
  for (const item of outputs) {
    if (!item) {
      continue;
    }

    output.outputs.push({
      target,
      ...item,
    });

    if (item.type === 'text') {
      output.replies.push({
        type: 'text',
        target,
        text: item.text,
      });
      continue;
    }

    if (item.type === 'image') {
      output.replies.push({
        type: 'image',
        target,
        image: item.image,
      });
    }
  }
}

function createRuntimeDeps(output, options = {}) {
  const responseMode = options.responseMode === 'send' ? 'send' : 'capture';
  const replySender = options.deps?.sendReply || sendReply;
  const structuredSender = options.deps?.sendStructuredReply || sendStructuredReply;
  const voiceSender = options.deps?.sendVoice || sendVoice;

  return {
    sendReply: async (target, text) => {
      appendStructuredOutputs(output, target, [{ type: 'text', text }]);
      if (responseMode === 'send') {
        await replySender(target, text);
      }
      return true;
    },
    sendStructuredReply: async (target, outputsToSend) => {
      appendStructuredOutputs(output, target, outputsToSend);
      if (responseMode === 'send') {
        await structuredSender(target, outputsToSend);
      }
      return true;
    },
    sendVoice: async (target, audio) => {
      output.voices.push({
        type: 'voice',
        target,
        audio,
      });
      if (responseMode === 'send') {
        await voiceSender(target, audio);
      }
      return true;
    },
    enqueuePersistJob: null,
  };
}

async function formatStructuredToolReply(event, options, output) {
  const deps = {
    ...(options.deps || {}),
  };
  if (typeof deps.retrieveMemoryContext !== 'function') {
    deps.retrieveMemoryContext = async () => ({
      eventMemories: [],
      memeMemories: [],
    });
  }
  const trace = options.trace || createTraceContext('tool-result', {
    chatType: event.chatType,
    chatId: event.chatId,
    userId: event.userId,
    messageId: event.messageId,
    route: options.pluginRoute || null,
    tool: options.toolResult?.tool || null,
  });
  const context = options.context || await buildWorkflowContext(event, trace, {
    ...deps,
  });
  const policy = (options.resolveUserPersonaPolicy || resolveUserPersonaPolicy)({
    userId: event.userId,
    scene: event.chatType,
    relation: context.relation,
    basePersona: 'yuno',
  });
  const text = formatToolResultAsYuno(options.toolResult, policy);
  const structuredOutputs = normalizeFormatterOutputs(options.toolResult, text);
  const mergedDeps = {
    ...deps,
    ...createRuntimeDeps(output, options),
  };

  await mergedDeps.sendStructuredReply({
    platform: event.platform,
    chatType: event.chatType,
    chatId: event.chatId,
  }, structuredOutputs);

  return {
    ok: true,
    suppressed: false,
    event,
    analysis: {
      shouldRespond: true,
      reason: 'tool-result',
      route: options.pluginRoute || null,
    },
    outputs: output,
    response: {
      text,
      voices: output.voices,
      outputs: structuredOutputs,
      toolResult: options.toolResult,
    },
    context,
    policy,
  };
}

export async function runYunoConversation(input, options = {}) {
  const event = input?.platform && input?.chatType
    ? normalizeLegacyMessageEvent(input)
    : buildYunoCoreEvent(input);
  const output = createOutputCollector();

  if (options.toolResult) {
    return formatStructuredToolReply(event, options, output);
  }

  const runtimeDeps = createRuntimeDeps(output, options);
  const pluginRoute = normalizePluginRoute(options.pluginRoute, event);
  const mergedDeps = {
    ...(options.deps || {}),
    ...runtimeDeps,
  };

  if (pluginRoute) {
    mergedDeps.planIncomingTask = async () => pluginRoute;
  }

  const decision = await (options.engine?.shouldRespondToEvent || shouldRespondToEvent)(event, {
    ...options,
    deps: mergedDeps,
  });

  if (!decision.analysis.shouldRespond) {
    return {
      ok: true,
      suppressed: true,
      event,
      analysis: decision.analysis,
      outputs: output,
      response: null,
    };
  }

  const replyText = await (options.engine?.processIncomingMessage || processIncomingMessage)(event, decision, {
    ...options,
    deps: mergedDeps,
    persistInline: true,
  });

  return {
    ok: true,
    suppressed: false,
    event,
    analysis: decision.analysis,
    outputs: output,
    response: {
      text: replyText,
      voices: output.voices,
      outputs: output.outputs,
    },
  };
}
