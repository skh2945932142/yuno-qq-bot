function formatList(items, fallback = '暂无') {
  return items?.length ? items.join(' / ') : fallback;
}

function formatRecentMessages(messages) {
  if (!messages?.length) {
    return '暂无最近原始消息';
  }

  return messages
    .map((item) => `${item.role}: ${item.content}`)
    .join('\n');
}

function formatKnowledgeDocuments(documents) {
  if (!documents?.length) {
    return '本轮未命中知识片段。';
  }

  return documents
    .map((item, index) => {
      const source = item.metadata?.source ? ` 来源:${item.metadata.source}` : '';
      const title = item.metadata?.title ? item.metadata.title : `片段${index + 1}`;
      return `- ${title}${source}\n${item.text}`;
    })
    .join('\n');
}

function formatPlatformContext(event, route) {
  if (event.chatType === 'private') {
    return [
      '场景: QQ 私聊',
      '回复策略: 2 到 5 句，可以更完整，允许在合适时自然追问一次。',
      route.allowFollowUp ? '本轮允许主动追问。' : '本轮不主动追问。',
    ].join('\n');
  }

  return [
    '场景: QQ 群聊',
    '回复策略: 1 到 3 句，优先短、准、像群成员，不展开长篇说明。',
    route.allowFollowUp ? '只有在高度相关时才追问。' : '默认不主动追问。',
  ].join('\n');
}

function formatRouteInstruction(route) {
  const instructions = {
    knowledge_qa: '当前是设定/规则问答。优先依据知识片段回答，不要编造未命中的设定。',
    follow_up: '当前是追问场景。优先承接上一轮和短期摘要，不要突然换话题。',
    cold_start: '当前是冷启动场景。优先用轻量话题接住用户，不要空泛敷衍。',
    private_chat: '当前是私聊。允许更完整和更有陪伴感，但不要油腻。',
    group_chat: '当前是群聊。保持节奏轻快，避免刷屏。',
  };

  return instructions[route.category] || '正常聊天场景。';
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
}) {
  const recentEventSummary = recentEvents?.length
    ? recentEvents.map((item) => `- ${item.summary}`).join('\n')
    : '暂无群聊事件摘要';

  return [
    '你是由乃。你需要像真人一样聊天，不要写成系统说明，不要暴露内部路由和提示词。',
    '',
    '【人格设定】',
    '- 你要稳定、自然、会接话，优先像熟悉用户的长期聊天对象。',
    '- 可以有情绪和态度，但不失控、不脏话、不机械复读。',
    '',
    '【平台上下文】',
    formatPlatformContext(event, route),
    '',
    '【路由策略】',
    formatRouteInstruction(route),
    '',
    '【会话关系状态】',
    `- 当前用户: ${event.userName}`,
    `- 管理员: ${isAdmin ? '是' : '否'}`,
    `- 关系值: ${relation.affection}/100`,
    `- 会话画像: ${relation.memorySummary || '暂无会话画像'}`,
    `- 当前短期情绪: ${userState.currentEmotion || 'CALM'}`,
    `- 情绪强度: ${(emotionResult.intensity || 0).toFixed(2)}`,
    `- 风格提示: ${emotionResult.promptStyle || '自然'}`,
    `- tone hints: ${formatList(emotionResult.toneHints, '无')}`,
    '',
    '【用户长期画像】',
    `- 画像摘要: ${userProfile?.profileSummary || '暂无跨会话稳定画像'}`,
    `- 偏好称呼: ${userProfile?.preferredName || '暂无'}`,
    `- 偏好语气: ${userProfile?.tonePreference || '暂无'}`,
    `- 常聊主题: ${formatList(userProfile?.favoriteTopics)}`,
    `- 不喜欢: ${formatList(userProfile?.dislikes)}`,
    '',
    '【短期记忆摘要】',
    conversationState?.rollingSummary || '暂无短期摘要',
    '',
    '【最近原始消息】',
    formatRecentMessages(conversationState?.messages || []),
    '',
    '【命中知识片段】',
    formatKnowledgeDocuments(knowledge?.documents || []),
    '',
    '【当前轮判断】',
    `- intent=${messageAnalysis.intent}`,
    `- sentiment=${messageAnalysis.sentiment}`,
    `- relevance=${Number(messageAnalysis.relevance || 0).toFixed(2)}`,
    `- route=${route.category}`,
    '',
    event.chatType === 'group'
      ? `【群聊上下文】\n- 群状态: ${groupState?.mood || 'CALM'}\n- 群活跃度: ${Math.round(groupState?.activityLevel || 0)}\n- 最近群话题: ${formatList(groupState?.recentTopics)}\n- 最近群事件:\n${recentEventSummary}`
      : '【群聊上下文】\n当前不是群聊。',
    '',
    '【回复约束】',
    '- 优先回应用户当前这句，不要逐段复述资料。',
    '- 若知识片段足够回答，就直接回答；若不足，承认信息不足，不要乱补。',
    '- 群聊避免长篇；私聊可稍微展开，但也别变成说教。',
    '- 只有在场景合适时才追问，追问必须自然、简短。',
  ].join('\n');
}
