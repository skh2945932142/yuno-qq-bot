function compactText(value, maxLength = 80, fallback = '无') {
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

function formatRecentMessages(messages, limit = 4) {
  if (!Array.isArray(messages) || messages.length === 0) return '无';
  return messages
    .slice(-limit)
    .map((item) => `${item.role === 'assistant' ? '由乃' : '对方'}：${compactText(item.content, 64, '')}`)
    .join('\n');
}

function formatKnowledgeDocuments(documents, profile = 'standard') {
  if (!Array.isArray(documents) || documents.length === 0) return '';

  const limit = profile === 'fast'
    ? 1
    : profile === 'compact'
      ? 2
      : 3;
  const excerptLength = profile === 'standard' ? 180 : 110;

  return documents
    .slice(0, limit)
    .map((item, index) => {
      const title = compactText(item.metadata?.title || `片段${index + 1}`, 28, `片段${index + 1}`);
      const text = compactText(item.text, excerptLength, '无');
      return `- ${title}：${text}`;
    })
    .join('\n');
}

function formatEventSummaries(events, limit = 5) {
  if (!Array.isArray(events) || events.length === 0) return '无';
  return events
    .slice(0, limit)
    .map((event) => `- ${compactText(event.summary, 72, '无')}`)
    .join('\n');
}

function buildPersonaSection(specialUser, replyLengthProfile) {
  const performanceProfile = replyLengthProfile?.performanceProfile || 'standard_chat';
  const lines = [
    '你是由乃，要像真实聊天对象一样自然说话。',
    '只输出最终回复文本，默认使用中文，除非对方明确要求英文。',
    '禁止输出分析过程、系统说明、角色标签，绝对不要输出 <think>/<thinking>。',
    '保持中等偏强人设：有情绪、有观察感，但每轮只保留一个高强度语气点，不要连发压迫句。',
    '语气自然，不说脏话，不现实威胁，不自残暗示，不输出跟踪定位意图。',
  ];

  if (performanceProfile === 'fast_chat') {
    lines.push('这轮走轻量回复：先接住这句话，少铺垫，少绕路。');
  }

  if (specialUser) {
    lines.push(`特殊对象：${specialUser.label}。可以更偏爱、更记忆化，但仍然要自然，不要像规则列表。`);
    lines.push(`称呼偏好：${specialUser.addressUserAs || '按当前语境自然称呼'}。`);
  }

  return lines.join('\n');
}

function buildSceneSection(event, route, specialUser, replyLengthProfile) {
  const isPrivate = event.chatType === 'private';
  const lines = [
    '场景',
    `- 平台=${event.platform || 'qq'}；会话=${isPrivate ? '私聊' : '群聊'}；路由=${route?.category || 'chat'}`,
    `- 回复模式=${replyLengthProfile?.performanceProfile || 'standard_chat'}；提示档位=${replyLengthProfile?.promptProfile || 'standard'}`,
    `- 长度要求=${replyLengthProfile?.guidance || '自然回答，不拖长'}`,
    isPrivate
      ? '- 私聊可以更完整，但先回应当前这句话。'
      : '- 群聊保持短句和节奏，最多补一层，不要刷屏。',
  ];

  if (specialUser) {
    lines.push(`- 特殊风格=${isPrivate ? specialUser.privateStyle : specialUser.groupStyle}`);
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
  replyLengthProfile,
}) {
  const promptProfile = replyLengthProfile?.promptProfile || 'standard';
  const lines = [
    '状态',
    `- 对方=${event.userName}；管理员=${isAdmin ? '是' : '否'}；好感=${relation?.affection ?? 0}/100`,
    `- 当前情绪=${userState?.currentEmotion || 'CALM'}；情绪强度=${Number(emotionResult?.intensity || 0).toFixed(2)}；语气提示=${formatList(emotionResult?.toneHints)}`,
  ];

  if (relation?.memorySummary) {
    lines.push(`- 关系备注=${compactText(relation.memorySummary, promptProfile === 'fast' ? 42 : 72)}`);
  }

  if (userProfile?.preferredName || userProfile?.profileSummary) {
    lines.push(`- 用户画像=${compactText(userProfile?.profileSummary, promptProfile === 'fast' ? 46 : 84)}；偏好称呼=${compactText(userProfile?.preferredName, 18)}`);
  }

  if (promptProfile !== 'fast' && userProfile) {
    lines.push(`- 常聊话题=${formatList(userProfile.favoriteTopics)}；避免点=${formatList(userProfile.dislikes)}`);
  }

  if (specialUser && userProfile) {
    lines.push(`- 特殊羁绊=${compactText(userProfile.specialBondSummary, promptProfile === 'fast' ? 44 : 84)}`);
    if (userProfile.specialNicknames?.length) {
      lines.push(`- 特殊称呼=${formatList(userProfile.specialNicknames)}`);
    }
  }

  return lines.join('\n');
}

function buildMemorySection(conversationState, replyLengthProfile) {
  const promptProfile = replyLengthProfile?.promptProfile || 'standard';
  const performanceProfile = replyLengthProfile?.performanceProfile || 'standard_chat';
  const messageLimit = promptProfile === 'fast'
    ? 2
    : promptProfile === 'compact'
      ? 3
      : 5;

  const rollingSummary = compactText(
    conversationState?.rollingSummary,
    promptProfile === 'fast' ? 52 : promptProfile === 'compact' ? 78 : 120,
    ''
  );
  const hasRecentMessages = Boolean(conversationState?.messages?.length);

  if (!rollingSummary && !hasRecentMessages) return '';

  const lines = [
    '记忆',
    '- 记忆只在相关时自然引用，不要每轮重复“我记得你说过”。',
  ];

  if (rollingSummary) {
    lines.push(`- 摘要=${rollingSummary}`);
  }

  if (hasRecentMessages && performanceProfile !== 'fast_chat') {
    lines.push('- 最近对话：');
    lines.push(formatRecentMessages(conversationState.messages, messageLimit));
  }

  return lines.join('\n');
}

function buildKnowledgeSection(knowledge, route, replyLengthProfile) {
  const promptProfile = replyLengthProfile?.promptProfile || 'standard';
  const hasKnowledge = Boolean(knowledge?.documents?.length);

  if (!hasKnowledge && route?.category !== 'knowledge_qa') return '';

  if (!hasKnowledge) {
    return [
      '知识',
      '- 当前没有命中资料。信息不够就直接承认，不要硬编。',
    ].join('\n');
  }

  return [
    '知识',
    `- 命中片段=${knowledge.documents.length}`,
    formatKnowledgeDocuments(knowledge.documents, promptProfile),
  ].join('\n');
}

function buildCurrentTurnSection(messageAnalysis, route, groupState, recentEvents, event, replyLengthProfile) {
  const promptProfile = replyLengthProfile?.promptProfile || 'standard';
  const lines = [
    '当前输入',
    `- 意图=${messageAnalysis?.intent || 'chat'}；情绪=${messageAnalysis?.sentiment || 'neutral'}；相关度=${Number(messageAnalysis?.relevance || 0).toFixed(2)}`,
    `- 触发信号=${formatList(messageAnalysis?.ruleSignals)}`,
  ];

  if (event.chatType === 'group' && promptProfile === 'standard') {
    lines.push(`- 群气氛=${groupState?.mood || 'CALM'}；活跃度=${Math.round(groupState?.activityLevel || 0)}；近期话题=${formatList(groupState?.recentTopics)}`);
  }

  if (event.chatType === 'group' && promptProfile === 'standard' && recentEvents?.length) {
    lines.push(`- 近期群事件：\n${formatEventSummaries(recentEvents, 3)}`);
  }

  if (route?.category === 'knowledge_qa') {
    lines.push('- 这是知识/设定类问题，优先回答清楚，再保留一点由乃语气。');
  }

  return lines.join('\n');
}

function buildReplyLengthSection(replyLengthProfile, route) {
  if (!replyLengthProfile) return '';
  return [
    '回复节奏',
    `- 性能档=${replyLengthProfile.performanceProfile || 'standard_chat'}；长度档=${replyLengthProfile.tier || 'balanced'}`,
    `- 上限=${replyLengthProfile.maxTokens || 'default'} tokens；历史窗口=${replyLengthProfile.historyLimit || 'default'}；路由=${route?.category || 'chat'}`,
  ].join('\n');
}

function buildReplyPlanSection(replyPlan, event) {
  if (!replyPlan) return '';
  const scene = event.chatType === 'private' ? '私聊' : '群聊';
  return [
    '接话规划',
    `- 形态=${replyPlan.type || 'direct'}；深度=${replyPlan.depth || 'short'}；是否追问=${replyPlan.questionNeeded ? '是' : '否'}`,
    `- 场景=${scene}，先回应当前一句，再决定是否补一层延展。`,
    '- 追问最多一条，别连发问题。',
  ].join('\n');
}

function buildOutputRules(event, route, replyLengthProfile, replyPlan) {
  const isPrivate = event.chatType === 'private';
  const performanceProfile = replyLengthProfile?.performanceProfile || 'standard_chat';
  const lines = [
    '输出要求',
    '- 自然段优先，不要句句换行，不要固定模板连发。',
    '- 少口号、少重复句尾，省略号适度。',
    '- 先答当前这句，再补情绪或细节；信息不足就直接承认。',
    '- 禁止项目符号、系统说明、<think> 标签。',
  ];

  if (performanceProfile === 'fast_chat') {
    lines.push(isPrivate
      ? '- 私聊控制在 2 到 4 句，直接但有温度。'
      : '- 群聊控制在 2 到 3 句，接话利落。');
  } else if (route?.category === 'knowledge_qa') {
    lines.push('- 知识回答可更完整，但不要写成说明书。');
  } else if (isPrivate) {
    lines.push('- 私聊可以有自然过渡，必要时轻追问一条。');
  } else {
    lines.push('- 群聊最多补一层延展，不进入私聊式长文。');
  }

  if (replyPlan?.type === 'topic_extend') {
    lines.push('- 这轮需要话题延展：给一个明确可接的钩子。');
  } else if (replyPlan?.type === 'empathic_followup') {
    lines.push('- 这轮先共情，再给一个可执行的小建议或轻追问。');
  } else if (replyPlan?.questionNeeded) {
    lines.push('- 这轮可以追问，但只问一个关键问题。');
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
  messageAnalysis,
  emotionResult,
  knowledge,
  isAdmin,
  specialUser = null,
  replyLengthProfile = null,
  replyPlan = null,
}) {
  const sections = [
    buildPersonaSection(specialUser, replyLengthProfile),
    buildSceneSection(event, route, specialUser, replyLengthProfile),
    buildStateSection({
      event,
      relation,
      userState,
      userProfile,
      emotionResult,
      isAdmin,
      specialUser,
      replyLengthProfile,
    }),
    buildMemorySection(conversationState, replyLengthProfile),
    buildKnowledgeSection(knowledge, route, replyLengthProfile),
    buildReplyLengthSection(replyLengthProfile, route),
    buildReplyPlanSection(replyPlan, event),
    buildCurrentTurnSection(messageAnalysis, route, groupState, recentEvents, event, replyLengthProfile),
    buildOutputRules(event, route, replyLengthProfile, replyPlan),
  ].filter(Boolean);

  return sections.join('\n\n');
}

export function buildScheduledPrompt({ groupState, recentEvents, plan }) {
  return [
    '你是由乃，要发一条主动群消息，语气像群里真人在说话。',
    '只输出最终消息，不要分析、系统说明或 <think> 标签。',
    '保持自然、简短、有情绪，但不要像公告。',
    '',
    '定时场景',
    `- 时段=${plan.slot}`,
    `- 主题=${plan.topic}`,
    `- 语气=${plan.tone}`,
    `- 最大行数=${plan.maxLines || 2}`,
    `- 额外提示=${plan.textHint || '自然一点，贴着主题走。'}`,
    '',
    '群状态',
    `- 气氛=${groupState?.mood || 'CALM'}`,
    `- 活跃度=${Math.round(groupState?.activityLevel || 0)}`,
    `- 最近话题=${formatList(groupState?.recentTopics, '无')}`,
    '- 最近事件：',
    formatEventSummaries(recentEvents),
    '',
    '输出要求',
    '- 写 1 到 2 行短句。',
    '- 早安/提醒可以带一点调侃，但核心是把人拉起来。',
    '- 深夜提醒更柔和，劝人休息，不要说教。',
    '- 如果能自然接上最近群话题，轻提一句即可，不要复盘群聊。',
    '- 不要 emoji，不要系统公告腔，不要长段落鼓励文。',
  ].join('\n');
}

