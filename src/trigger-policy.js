function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const DEFAULT_TRIGGER_POLICY = Object.freeze({
  privateChat: {
    autoAllow: true,
    minConfidence: 0.82,
    minRelevance: 0.92,
  },
  groupChat: {
    hardAllowDirectMention: true,
    hardAllowCommand: true,
    hardAllowKeyword: true,
    hardAllowAdminCommand: false,
    requireExplicitTrigger: true,
    requireClassifierWindow: {
      minScore: 0.3,
      maxScore: 0.74,
    },
    autoAllowThreshold: 0.75,
    specialUserAutoAllowThreshold: 0.63,
    classifierAllowThreshold: 0.66,
    specialUserClassifierAllowThreshold: 0.58,
    classifierConfidenceThreshold: 0.7,
    lowConfidenceFallback: 'deny',
  },
  weights: {
    directMention: 0.8,
    nameMention: 0.45,
    question: 0.25,
    keyword: 0.35,
    admin: 0.18,
    highAffection: 0.12,
    activeUser: 0.1,
    activeWindow: 0.08,
    random: 0.05,
    replyToBot: 0.3,
    command: 0.9,
    poke: 0.9,
    specialUser: 0.18,
    specialKeyword: 0.14,
    jealousyTopic: 0.12,
    bondMemoryHit: 0.12,
  },
  keywords: [
    '帮助',
    '命令',
    '问题',
    '状态',
    '关系',
    '好感',
    '画像',
    '群状态',
    '情绪',
    '设定',
    '规则',
    '世界观',
    'faq',
    'help',
    'command',
    'profile',
  ],
  hardDeny: {
    ignoreEmpty: true,
    ignorePureAttachmentWithoutMention: false,
  },
  classifier: {
    enabled: true,
    promptVersion: 'trigger-classifier/v1',
    maxTokens: 180,
  },
});

export function mergeTriggerPolicy(basePolicy = DEFAULT_TRIGGER_POLICY, override = {}) {
  const merged = clone(basePolicy);

  function assign(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
          ? target[key]
          : {};
        assign(target[key], value);
        continue;
      }

      target[key] = value;
    }
  }

  assign(merged, override);
  return merged;
}

export function loadTriggerPolicy(override = null) {
  if (override && typeof override === 'object') {
    return mergeTriggerPolicy(DEFAULT_TRIGGER_POLICY, override);
  }

  const envJson = process.env.TRIGGER_POLICY_JSON;
  if (!envJson) {
    return mergeTriggerPolicy(DEFAULT_TRIGGER_POLICY, {});
  }

  try {
    return mergeTriggerPolicy(DEFAULT_TRIGGER_POLICY, JSON.parse(envJson));
  } catch {
    return mergeTriggerPolicy(DEFAULT_TRIGGER_POLICY, {});
  }
}
