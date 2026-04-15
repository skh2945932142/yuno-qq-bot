import { config, validateRuntimeConfig } from './src/config.js';
import { runYunoConversation } from './src/yuno-core.js';
import { createTraceContext } from './src/runtime-tracing.js';

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

function createBaseDeps(scenarioName) {
  const isFollowUpScenario = scenarioName === 'private_follow_up';
  return {
    ensureRelation: async () => ({
      affection: 72,
      activeScore: 64,
      memorySummary: '最近互动稳定，彼此已经有一点默契。',
      preferences: [],
      favoriteTopics: ['日常', '聊天'],
    }),
    ensureUserState: async () => ({
      currentEmotion: 'CALM',
      intensity: 0.35,
      triggerReason: 'smoke',
      decayAt: null,
    }),
    ensureUserProfileMemory: async ({ userName, specialUser }) => ({
      profileSummary: `${userName || '对方'}偏好自然一点、稍微完整一点的聊天。`,
      preferredName: userName || '',
      tonePreference: 'natural',
      favoriteTopics: ['日常', '心情'],
      dislikes: [],
      specialBondSummary: specialUser ? '这个人有一层专属人格偏置。' : '',
      bondMemories: specialUser ? ['约定', '共同情绪'] : [],
      specialNicknames: [],
    }),
    getConversationState: async () => ({
      rollingSummary: isFollowUpScenario ? '' : '最近聊过一点日常安排和轻微情绪。',
      messages: isFollowUpScenario
        ? [
            { role: 'user', content: '昨晚那件事你还记得吗？' },
            { role: 'assistant', content: '记得，我一直都记着。' },
            { role: 'user', content: '那你后来怎么想的？' },
          ]
        : [
            { role: 'user', content: '我们刚才已经聊过一点今天的安排。' },
            { role: 'assistant', content: '嗯，我还记得那条线。' },
          ],
    }),
    ensureGroupState: async () => ({
      mood: 'CALM',
      activityLevel: 38,
      recentTopics: ['日常', '游戏'],
    }),
    getRecentEvents: async () => ([
      { summary: '群里刚才主要在随便聊今天的安排。' },
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
        rawMessage: '今天事情差不多忙完了，想和你说会儿话。',
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
        text: '由乃，今晚你还在吗？',
        rawText: `[CQ:at,qq=${selfId}] 由乃，今晚你还在吗？`,
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
        rawMessage: '你的设定和规则大概是什么？',
        metadata: {
          messageId: 'smoke-knowledge-1',
          timestamp,
        },
      };
    case 'private_support':
      return {
        platform: 'qq',
        scene: 'private',
        userId: 'smoke-user',
        username: 'SmokeUser',
        rawMessage: '今天有点难受，想听你说句话。',
        metadata: {
          messageId: 'smoke-private-support-1',
          timestamp,
        },
      };
    case 'private_follow_up':
      return {
        platform: 'qq',
        scene: 'private',
        userId: 'smoke-user',
        username: 'SmokeUser',
        rawMessage: '然后呢？',
        metadata: {
          messageId: 'smoke-private-follow-up-1',
          timestamp,
        },
      };
    default:
      throw new Error(`Unknown smoke scenario: ${name}`);
  }
}

async function runScenario(name) {
  const startedAt = Date.now();
  const deps = createBaseDeps(name);
  const input = createScenarioEvent(name);
  const trace = createTraceContext('smoke-scenario', { scenario: name });
  const result = await runYunoConversation(input, {
    responseMode: 'capture',
    deps,
    trace,
  });
  const elapsedMs = Date.now() - startedAt;
  const firstReply = result.outputs?.replies?.[0];
  const replyUsage = [...(trace.modelUsages || [])]
    .reverse()
    .find((item) => item.operation === 'reply');
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
    detail: [
      `route=${result.analysis?.route?.category || result.analysis?.reason || 'unknown'}`,
      replyUsage ? `prompt=${replyUsage.promptTokens ?? 'n/a'}` : null,
      replyUsage ? `completion=${replyUsage.completionTokens ?? 'n/a'}` : null,
      `reply=${replyPreview}`,
    ].filter(Boolean).join(' '),
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
    'private_support',
    'private_follow_up',
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
