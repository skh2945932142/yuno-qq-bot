import { config, validateRuntimeConfig } from './src/config.js';
import { runYunoConversation } from './src/yuno-core.js';

function truncateValue(value, limit = 120) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1))}...`;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) {
    return '0ms';
  }

  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }

  return `${(value / 1000).toFixed(2)}s`;
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function printCheckLine(result) {
  const label = String(result.status || '').trim().toUpperCase().padEnd(10, ' ');
  const parts = [`[${label}]`, result.name];

  if (result.elapsedMs !== undefined) {
    parts.push(`(${formatDuration(result.elapsedMs)})`);
  }

  if (result.detail) {
    parts.push(`- ${result.detail}`);
  }

  console.log(parts.join(' '));
}

function summarizeResults(results) {
  const summary = {
    pass: 0,
    fail: 0,
    warn: 0,
    skip: 0,
  };

  for (const result of results) {
    if (summary[result.status] === undefined) {
      continue;
    }
    summary[result.status] += 1;
  }

  return summary;
}

function hasFailures(results) {
  return results.some((result) => result.status === 'fail');
}

function createBaseDeps() {
  return {
    ensureRelation: async () => ({
      affection: 72,
      activeScore: 64,
      memorySummary: 'Recent interactions are stable and coherent.',
      preferences: [],
      favoriteTopics: ['daily-life', 'chat'],
    }),
    ensureUserState: async () => ({
      currentEmotion: 'CALM',
      intensity: 0.35,
      triggerReason: 'smoke',
      decayAt: null,
    }),
    ensureUserProfileMemory: async ({ userName, specialUser }) => ({
      profileSummary: `${userName || 'User'} prefers natural conversation and a slightly complete reply.`,
      preferredName: userName || '',
      tonePreference: 'natural',
      favoriteTopics: ['daily-life', 'mood'],
      dislikes: [],
      specialBondSummary: specialUser ? 'This user has a special persona overlay.' : '',
      bondMemories: specialUser ? ['promise', 'shared-emotion'] : [],
      specialNicknames: [],
    }),
    getConversationState: async () => ({
      rollingSummary: 'The recent turns are about daily plans and a little emotional context.',
      messages: [
        { role: 'user', content: 'We already talked a little about today.' },
        { role: 'assistant', content: 'Yes. I still remember the thread.' },
      ],
    }),
    ensureGroupState: async () => ({
      mood: 'CALM',
      activityLevel: 38,
      recentTopics: ['daily-life', 'games'],
    }),
    getRecentEvents: async () => ([
      { summary: 'The group has mostly been chatting casually about daily plans.' },
    ]),
    updateRelationProfile: async () => null,
    updateUserState: async () => null,
    appendConversationMessages: async () => null,
    updateUserProfileMemory: async () => null,
    updateGroupStateFromAnalysis: async () => null,
    recordGroupEvent: async () => null,
    shouldSendVoiceForEmotion: () => false,
    sendVoice: async () => true,
    enqueuePersistJob: null,
  };
}

function createScenarioEvent(name) {
  const selfId = config.selfQq || '10000';
  const timestamp = Date.now();

  switch (name) {
    case 'private_chat':
      return {
        platform: 'qq',
        scene: 'private',
        userId: 'smoke-user',
        username: 'SmokeUser',
        rawMessage: 'Today was a little tiring. I want to talk for a bit.',
        metadata: {
          messageId: 'smoke-private-1',
          timestamp,
        },
      };
    case 'group_mention':
      return {
        platform: 'qq',
        chatType: 'group',
        chatId: 'smoke-group',
        userId: 'smoke-user',
        userName: 'SmokeUser',
        messageId: 'smoke-group-mention-1',
        replyTo: '',
        text: 'Yuno, can you talk with me for a bit tonight?',
        rawText: `[CQ:at,qq=${selfId}] Yuno, can you talk with me for a bit tonight?`,
        mentionsBot: true,
        attachments: [],
        timestamp,
        source: {
          adapter: 'smoke',
          postType: 'message',
          messageType: 'group',
        },
        selfId,
        sender: {},
      };
    case 'command_help':
      return {
        platform: 'qq',
        chatType: 'group',
        chatId: 'smoke-group',
        userId: 'smoke-user',
        userName: 'SmokeUser',
        messageId: 'smoke-command-1',
        replyTo: '',
        text: '/help',
        rawText: '/help',
        mentionsBot: false,
        attachments: [],
        timestamp,
        source: {
          adapter: 'smoke',
          postType: 'message',
          messageType: 'group',
        },
        selfId,
        sender: {},
      };
    case 'poke_non_target':
      return {
        platform: 'qq',
        chatType: 'group',
        chatId: 'smoke-group',
        userId: 'smoke-user',
        userName: 'SmokeUser',
        messageId: '',
        replyTo: '',
        text: '/poke',
        rawText: '[poke]',
        mentionsBot: false,
        attachments: [],
        timestamp,
        source: {
          adapter: 'smoke',
          postType: 'notice',
          messageType: 'group',
          noticeType: 'notify',
          subType: 'poke',
        },
        selfId,
        sender: {},
      };
    case 'knowledge_chat':
      return {
        platform: 'qq',
        scene: 'private',
        userId: 'smoke-user',
        username: 'SmokeUser',
        rawMessage: 'What are your persona rules and settings?',
        metadata: {
          messageId: 'smoke-knowledge-1',
          timestamp,
        },
      };
    default:
      throw new Error(`Unknown smoke scenario: ${name}`);
  }
}

async function runScenario(name) {
  const startedAt = Date.now();
  const deps = createBaseDeps();
  const input = createScenarioEvent(name);
  const result = await runYunoConversation(input, {
    responseMode: 'capture',
    deps,
  });
  const elapsedMs = Date.now() - startedAt;
  const firstReply = result.outputs?.replies?.[0];
  const replyPreview = firstReply?.text
    ? truncateValue(firstReply.text, 100)
    : firstReply?.type === 'image'
      ? '[image]'
      : result.suppressed
        ? '(suppressed)'
        : '(no text output)';

  if (name === 'poke_non_target') {
    if (!result.suppressed) {
      throw new Error('non-target poke should have been suppressed');
    }

    return {
      name,
      status: 'pass',
      detail: `suppressed reason=${result.analysis?.reason || 'unknown'}`,
      elapsedMs,
    };
  }

  if (result.suppressed) {
    throw new Error(`scenario was suppressed unexpectedly (${result.analysis?.reason || 'unknown'})`);
  }

  return {
    name,
    status: 'pass',
    detail: `route=${result.analysis?.route?.category || result.analysis?.reason || 'unknown'} reply=${replyPreview}`,
    elapsedMs,
  };
}

async function main() {
  validateRuntimeConfig();

  printHeader('Yuno Runtime Smoke');
  console.log('mode=capture-only');
  console.log('persistence=disabled');
  console.log('outbound-send=disabled');

  const scenarioNames = [
    'private_chat',
    'group_mention',
    'command_help',
    'poke_non_target',
  ];

  if (config.qdrantUrl && config.qdrantCollection) {
    scenarioNames.push('knowledge_chat');
  }

  const results = [];
  for (const name of scenarioNames) {
    try {
      const result = await runScenario(name);
      results.push(result);
      printCheckLine(result);
    } catch (error) {
      const failure = {
        name,
        status: 'fail',
        detail: truncateValue(error.message || String(error), 200),
      };
      results.push(failure);
      printCheckLine(failure);
    }
  }

  const summary = summarizeResults(results);
  printHeader('Summary');
  console.log(`pass=${summary.pass} warn=${summary.warn} skip=${summary.skip} fail=${summary.fail}`);

  process.exitCode = hasFailures(results) ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
