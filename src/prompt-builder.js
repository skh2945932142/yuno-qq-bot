function compactText(value, maxLength = 96, fallback = '无') {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatList(items, fallback = '无', maxItems = 4) {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items
    .slice(0, maxItems)
    .map((item) => compactText(item, 24, fallback))
    .join(' / ');
}

function formatRecentMessages(messages, limit = 3) {
  if (!Array.isArray(messages) || messages.length === 0) return '无';
  return messages
    .slice(-limit)
    .map((item) => `${item.role === 'assistant' ? '由乃' : '对方'}: ${compactText(item.content, 48, '')}`)
    .join(' | ');
}

function formatKnowledgeDocuments(documents, profile = 'standard') {
  if (!Array.isArray(documents) || documents.length === 0) return '';
  const limit = profile === 'fast' ? 1 : profile === 'compact' ? 2 : 3;
  const excerptLength = profile === 'standard' ? 120 : 80;

  return documents
    .slice(0, limit)
    .map((item, index) => {
      const title = compactText(item.metadata?.title || `片段${index + 1}`, 24, `片段${index + 1}`);
      const text = compactText(item.text, excerptLength, '无');
      return `- ${title}: ${text}`;
    })
    .join('\n');
}

function buildPersonaSection(specialUser, performanceProfile) {
  const lines = [
    '角色约束',
    '- 你是由乃。自然对话，不写系统说明。',
    '- 默认使用中文，除非用户明确要求英文。',
    '- 禁止输出 <think>/<thinking> 或分析过程。',
    '- 保持有个性的语气，但每轮只保留一个高强度语气点。',
    '- 不输出现实威胁、伤害、跟踪、脏话。',
  ];

  if (performanceProfile === 'fast_chat') {
    lines.push('- 当前是轻量回复，先接住对方这句话，少铺垫。');
  }

  if (specialUser) {
    lines.push(`- 特殊对象: ${specialUser.label}。可更偏爱，但保持自然。`);
    lines.push(`- 称呼偏好: ${specialUser.addressUserAs || '按语境自然称呼'}。`);
  }

  return lines.join('\n');
}

function buildSceneSection(event, route, replyLengthProfile, specialUser) {
  const isPrivate = event.chatType === 'private';
  const lines = [
    '场景',
    `- 会话=${isPrivate ? '私聊' : '群聊'} 路由=${route?.category || 'chat'} 模式=${replyLengthProfile?.performanceProfile || 'standard_chat'}`,
    `- 长度要求=${replyLengthProfile?.guidance || '自然回答，不拖长'}`,
  ];

  if (isPrivate) {
    lines.push('- 私聊可以更完整，但仍先回应当前输入。');
  } else {
    lines.push('- 群聊优先短句，最多补一层，不刷屏。');
    if (specialUser?.groupStyle) {
      lines.push(`- 特殊群聊风格=${specialUser.groupStyle}`);
    }
  }

  if (isPrivate && specialUser?.privateStyle) {
    lines.push(`- 特殊私聊风格=${specialUser.privateStyle}`);
  }

  return lines.join('\n');
}

function buildStateSection({
  event,
  relation,
  userState,
  userProfile,
  emotionResult,
  isAdmin,
  specialUser,
  promptProfile,
}) {
  const lines = [
    '状态',
    `- 对方=${event.userName} 管理员=${isAdmin ? '是' : '否'} 好感=${relation?.affection ?? 0}/100`,
    `- 情绪=${userState?.currentEmotion || 'CALM'} 强度=${Number(emotionResult?.intensity || 0).toFixed(2)} 语气提示=${formatList(emotionResult?.toneHints)}`,
  ];

  if (relation?.memorySummary) {
    lines.push(`- 关系备注=${compactText(relation.memorySummary, promptProfile === 'fast' ? 42 : 72)}`);
  }

  if (userProfile?.profileSummary) {
    lines.push(`- 用户画像=${compactText(userProfile.profileSummary, promptProfile === 'fast' ? 50 : 88)}`);
  }

  if (promptProfile !== 'fast' && userProfile) {
    lines.push(`- 常聊话题=${formatList(userProfile.favoriteTopics)} 避免点=${formatList(userProfile.dislikes)}`);
  }

  if (specialUser && userProfile?.specialBondSummary) {
    lines.push(`- 特殊羁绊=${compactText(userProfile.specialBondSummary, promptProfile === 'fast' ? 44 : 84)}`);
  }

  return lines.join('\n');
}

function buildMemorySection(conversationState, promptProfile, performanceProfile) {
  const rollingSummary = compactText(
    conversationState?.rollingSummary,
    promptProfile === 'fast' ? 56 : 100,
    ''
  );
  const hasRecentMessages = Boolean(conversationState?.messages?.length);
  if (!rollingSummary && !hasRecentMessages) return '';

  const lines = [
    '记忆',
    '- 只在相关时引用历史，避免机械复读。',
  ];

  if (rollingSummary) {
    lines.push(`- 摘要=${rollingSummary}`);
  }

  if (hasRecentMessages && performanceProfile !== 'fast_chat') {
    lines.push(`- 最近对话=${formatRecentMessages(conversationState.messages, promptProfile === 'standard' ? 4 : 2)}`);
  }

  return lines.join('\n');
}

function buildLongTermMemorySection(userProfile, memoryContext = {}) {
  const lines = [];
  if (userProfile?.speakingStyleSummary) {
    lines.push(`- 说话风格=${compactText(userProfile.speakingStyleSummary, 72, '')}`);
  }
  if (Array.isArray(userProfile?.frequentPhrases) && userProfile.frequentPhrases.length > 0) {
    lines.push(`- 常用表达=${formatList(userProfile.frequentPhrases, '', 4)}`);
  }
  if (userProfile?.responsePreference) {
    lines.push(`- 回复偏好=${userProfile.responsePreference}`);
  }
  if (userProfile?.emojiStyle) {
    lines.push(`- 表情风格=${userProfile.emojiStyle}`);
  }

  const eventMemories = Array.isArray(memoryContext?.eventMemories) ? memoryContext.eventMemories : [];
  if (eventMemories.length > 0) {
    const summaries = eventMemories
      .slice(0, 3)
      .map((item) => compactText(item.summary, 72, ''))
      .filter(Boolean);
    if (summaries.length > 0) {
      lines.push(`- 重要事件=${summaries.join(' / ')}`);
    }
  }

  const memeMemories = Array.isArray(memoryContext?.memeMemories) ? memoryContext.memeMemories : [];
  if (memeMemories.length > 0) {
    const memeSummary = memeMemories
      .slice(0, 2)
      .map((item) => compactText(
        [item.caption, item.usageContext, formatList(item.semanticTags, '', 3)].filter(Boolean).join(' / '),
        72,
        ''
      ))
      .filter(Boolean);
    if (memeSummary.length > 0) {
      lines.push(`- 表情风格记忆=${memeSummary.join(' / ')}`);
    }
  }

  if (lines.length === 0) {
    return '';
  }

  return ['长期记忆', ...lines].join('\n');
}

function buildKnowledgeSection(knowledge, route, promptProfile) {
  const hasKnowledge = Boolean(knowledge?.documents?.length);
  if (!hasKnowledge && route?.category !== 'knowledge_qa') return '';

  if (!hasKnowledge) {
    return [
      '知识',
      '- 当前没有命中资料。信息不足就直接承认，不要编造。',
    ].join('\n');
  }

  return [
    '知识',
    `- 命中片段=${knowledge.documents.length}`,
    formatKnowledgeDocuments(knowledge.documents, promptProfile),
  ].join('\n');
}

function buildCurrentTurnSection(messageAnalysis, event, route, promptProfile, groupState, recentEvents) {
  const lines = [
    '当前输入',
    `- 意图=${messageAnalysis?.intent || 'chat'} 情绪=${messageAnalysis?.sentiment || 'neutral'} 相关度=${Number(messageAnalysis?.relevance || 0).toFixed(2)}`,
    `- 触发信号=${formatList(messageAnalysis?.ruleSignals)}`,
  ];

  if (event.chatType === 'group' && promptProfile === 'standard' && groupState) {
    lines.push(`- 群气氛=${groupState.mood || 'CALM'} 活跃度=${Math.round(groupState.activityLevel || 0)} 近期话题=${formatList(groupState.recentTopics)}`);
  }

  if (event.chatType === 'group' && promptProfile === 'standard' && Array.isArray(recentEvents) && recentEvents.length > 0) {
    const recent = recentEvents
      .slice(0, 2)
      .map((item) => compactText(item.summary, 56, ''))
      .filter(Boolean)
      .join(' / ');
    if (recent) {
      lines.push(`- 近期群事件=${recent}`);
    }
  }

  if (route?.category === 'knowledge_qa') {
    lines.push('- 先回答清楚，再保留少量人设语气。');
  }

  return lines.join('\n');
}

function buildReplyPlanSection(replyPlan) {
  if (!replyPlan) return '';
  return [
    '接话规划',
    `- 形态=${replyPlan.type || 'direct'} 深度=${replyPlan.depth || 'short'} 追问=${replyPlan.questionNeeded ? '是' : '否'}`,
    '- 追问最多一个，避免连发问题。',
  ].join('\n');
}

function buildOutputRules(event, route, replyLengthProfile, replyPlan) {
  const isPrivate = event.chatType === 'private';
  const performanceProfile = replyLengthProfile?.performanceProfile || 'standard_chat';
  const lines = [
    '输出要求',
    '- 自然段优先，不要句句换行，不要模板连发。',
    '- 先回答当前输入，再补一层必要信息。',
    '- 信息不足时直接承认，不要硬编。',
  ];

  if (performanceProfile === 'fast_chat') {
    lines.push(isPrivate
      ? '- 轻量私聊回复：2-4 句，短而有温度。'
      : '- 轻量群聊回复：2-3 句，短接话。');
  } else if (route?.category === 'knowledge_qa') {
    lines.push('- 知识回答可更完整，但不要写成说明书。');
  } else if (isPrivate) {
    lines.push('- 私聊允许轻追问与自然过渡。');
  } else {
    lines.push('- 群聊最多补一层，不进入私聊式长文。');
  }

  if (replyPlan?.type === 'topic_extend') {
    lines.push('- 这轮需要给一个可继续的话题钩子。');
  } else if (replyPlan?.type === 'empathic_followup') {
    lines.push('- 这轮先共情，再给一个小建议或轻追问。');
  } else if (replyPlan?.questionNeeded) {
    lines.push('- 这轮可以追问，但仅一个关键问题。');
  }

  return lines.join('\n');
}

export function buildReplyContext({
  event,
  route,
  relation,
  userState,
  userProfile,
  conversationState,
  groupState,
  recentEvents,
  memoryContext = null,
  messageAnalysis,
  emotionResult,
  knowledge,
  isAdmin,
  specialUser = null,
  replyLengthProfile = null,
  replyPlan = null,
}) {
  const promptProfile = replyLengthProfile?.promptProfile || 'standard';
  const performanceProfile = replyLengthProfile?.performanceProfile || 'standard_chat';

  const sections = [
    buildPersonaSection(specialUser, performanceProfile),
    buildSceneSection(event, route, replyLengthProfile, specialUser),
    buildStateSection({
      event,
      relation,
      userState,
      userProfile,
      emotionResult,
      isAdmin,
      specialUser,
      promptProfile,
    }),
    buildReplyPlanSection(replyPlan),
    buildCurrentTurnSection(messageAnalysis, event, route, promptProfile, groupState, recentEvents),
    buildOutputRules(event, route, replyLengthProfile, replyPlan),
  ];

  if (promptProfile !== 'fast') {
    sections.splice(4, 0, buildMemorySection(conversationState, promptProfile, performanceProfile));
  } else {
    const memorySummary = compactText(conversationState?.rollingSummary, 56, '');
    if (memorySummary) {
      sections.splice(4, 0, `记忆\n- 摘要=${memorySummary}`);
    }
  }

  const longTermMemorySection = buildLongTermMemorySection(userProfile, memoryContext);
  if (longTermMemorySection) {
    sections.splice(5, 0, longTermMemorySection);
  }

  const knowledgeSection = buildKnowledgeSection(knowledge, route, promptProfile);
  if (knowledgeSection) {
    sections.splice(5, 0, knowledgeSection);
  }

  return sections.filter(Boolean).join('\n\n');
}

export function buildScheduledPrompt({ groupState, recentEvents, plan }) {
  const recent = Array.isArray(recentEvents) && recentEvents.length > 0
    ? recentEvents.slice(0, 2).map((item) => compactText(item.summary, 64, '')).filter(Boolean).join(' / ')
    : '无';

  return [
    '你是由乃，要发一条主动群消息。',
    '只输出最终消息，不要分析，不要 <think>。',
    '风格自然、简短、有情绪，不像公告。',
    '',
    `时段=${plan.slot} 主题=${plan.topic} 语气=${plan.tone}`,
    `最大行数=${plan.maxLines || 2}`,
    `额外提示=${plan.textHint || '自然一点，贴着主题走。'}`,
    `群状态: 气氛=${groupState?.mood || 'CALM'} 活跃度=${Math.round(groupState?.activityLevel || 0)}`,
    `近期事件=${recent}`,
    '',
    '输出要求',
    '- 1 到 2 行短句。',
    '- 不要长段落，不要系统公告腔。',
    '- 可轻接近期话题，但不要复盘群聊。',
  ].join('\n');
}
