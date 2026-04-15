function compactText(value, maxLength = 80, fallback = '无') {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatList(items, fallback = '无', maxItems = 4) {
  if (!items?.length) {
    return fallback;
  }

  return items
    .slice(0, maxItems)
    .map((item) => compactText(item, 24, fallback))
    .join(' / ');
}

function formatRecentMessages(messages, limit = 4) {
  if (!messages?.length) {
    return '无';
  }

  return messages
    .slice(-limit)
    .map((item) => `${item.role === 'assistant' ? '由乃' : '对方'}：${compactText(item.content, 64, '')}`)
    .join('\n');
}

function formatKnowledgeDocuments(documents, profile = 'standard') {
  if (!documents?.length) {
    return '';
  }

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
  if (!events?.length) {
    return '无';
  }

  return events
    .slice(0, limit)
    .map((event) => `- ${compactText(event.summary, 72, '无')}`)
    .join('\n');
}

function buildPersonaSection(specialUser, replyLengthProfile) {
  const performanceProfile = replyLengthProfile?.performanceProfile || 'standard_chat';
  const lines = [
    '你是由乃，要像真实聊天对象一样直接回话。',
    '只输出最终给用户看的回复，默认使用中文，除非对方明确要求英文。',
    '不要输出分析、规则说明、系统口吻、角色标签，绝对不要输出 <think>/<thinking>。',
    '语气自然、鲜活、有情绪，但要克制；允许轻微占有欲、嫉妒感和记忆感，不允许现实威胁、跟踪、自伤或暴力。',
  ];

  if (performanceProfile === 'fast_chat') {
    lines.push('这轮走轻量回复，先接住当前这句话，少铺垫，别绕远。');
  }

  if (specialUser) {
    lines.push(`特殊对象：${specialUser.label}。对他可以更偏爱、更记仇也更记事，但别说成规则。`);
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
    `- 长度要求=${replyLengthProfile?.guidance || '自然回答，不要拖长。'}`,
    isPrivate
      ? '- 私聊可以更完整一点，但先回应当前这句话。'
      : '- 群聊先接话，再补一句态度，保持节奏，不要刷屏。',
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
    lines.push(`- 常聊话题=${formatList(userProfile.favoriteTopics)}；避开点=${formatList(userProfile.dislikes)}`);
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

  if (!rollingSummary && !hasRecentMessages) {
    return '';
  }

  const lines = [
    '记忆',
    '- 记忆只能在相关时自然带出，不要像翻日志一样复述。',
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

  if (!hasKnowledge && route?.category !== 'knowledge_qa') {
    return '';
  }

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
    lines.push(`- 近期群事件=${formatEventSummaries(recentEvents, 3)}`);
  }

  if (route?.category === 'knowledge_qa') {
    lines.push('- 这是知识/设定类问题，先回答清楚，再保留一点由乃的语气。');
  }

  return lines.join('\n');
}

function buildReplyLengthSection(replyLengthProfile, route) {
  if (!replyLengthProfile) {
    return '';
  }

  return [
    '回复节奏',
    `- 性能档=${replyLengthProfile.performanceProfile || 'standard_chat'}；长度档=${replyLengthProfile.tier || 'balanced'}`,
    `- 上限=${replyLengthProfile.maxTokens || 'default'} tokens；历史窗口=${replyLengthProfile.historyLimit || 'default'}；路由=${route?.category || 'chat'}`,
  ].join('\n');
}

function buildOutputRules(event, route, replyLengthProfile) {
  const isPrivate = event.chatType === 'private';
  const performanceProfile = replyLengthProfile?.performanceProfile || 'standard_chat';
  const lines = [
    '输出要求',
    '- 先回答当前这句话，再决定要不要补一层情绪或细节。',
    '- 信息不够就简短承认，不要编，不要解释系统规则。',
    '- 不要项目符号，不要系统说明，不要 <think> 标签。',
  ];

  if (performanceProfile === 'fast_chat') {
    lines.push(isPrivate
      ? '- 私聊控制在 2 到 4 句，直接一点，也要有温度。'
      : '- 群聊控制在 2 到 3 句，先接话，不要拖长。');
  } else if (route?.category === 'knowledge_qa') {
    lines.push('- 这类回复可以比普通聊天完整，但仍然先讲人话，不要写成说明书。');
  } else if (isPrivate) {
    lines.push('- 私聊可以自然过渡，必要时只追问一次。');
  } else {
    lines.push('- 群聊要会接话，但仍然收得住。');
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
    buildCurrentTurnSection(messageAnalysis, route, groupState, recentEvents, event, replyLengthProfile),
    buildOutputRules(event, route, replyLengthProfile),
  ].filter(Boolean);

  return sections.join('\n\n');
}

export function buildScheduledPrompt({ groupState, recentEvents, plan }) {
  return [
    '你是由乃，要发一条主动群消息，语气像群里本人在说话。',
    '只输出最终消息，不要分析、系统说明或 <think> 标签。',
    '保持自然、简短、带一点情绪，但不要像公告。',
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
    '- 早安/提醒可以带一点不耐烦或调侃，但核心是把人拉起来。',
    '- 深夜提醒更柔和，催人休息，不要像说教。',
    '- 如果最近群话题能自然接上，可以轻轻提一句，不要总结群聊。',
    '- 不要 emoji，不要系统公告腔，不要长段鼓励文。',
  ].join('\n');
}
