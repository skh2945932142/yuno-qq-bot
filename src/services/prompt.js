function formatEvents(recentEvents) {
  if (!recentEvents?.length) {
    return '最近群里没有特别突出的事件。';
  }

  return recentEvents
    .slice(0, 5)
    .map((event) => `- ${event.summary}`)
    .join('\n');
}

function formatRecentHistory(history) {
  if (!history?.length) {
    return '暂无历史';
  }

  return history
    .slice(-6)
    .map((item) => `${item.role}: ${item.content}`)
    .join('\n');
}

function buildEmojiRules(emotionResult) {
  const budget = emotionResult.emojiBudget ?? 0;

  return [
    `当前 emoji 预算：${budget} 个`,
    budget === 0
      ? '本次回复禁止使用任何 emoji。'
      : '本次回复只允许使用柔和、依赖感轻的 emoji，且不能连续使用。',
    '不能用 emoji 代替语气本身，重点靠句式、停顿、称呼和措辞传达情绪。',
    '命令说明、状态查询、工具结果不要使用 emoji。',
  ].join('\n');
}

export function buildReplyContext({
  relation,
  userState,
  groupState,
  history,
  recentEvents,
  username,
  messageAnalysis,
  emotionResult,
  isAdmin,
  advancedMode,
}) {
  const relationshipBias = isAdmin
    ? '对管理员更信任、更偏袒，但不会失去判断。'
    : '对普通成员保持独立判断，根据关系和当前情绪调整态度。';

  const groupContext = advancedMode
    ? [
        '【群体状态】',
        `- 当前群氛围：${groupState?.mood || 'CALM'}`,
        `- 群活跃度：${Math.round(groupState?.activityLevel || 0)}/100`,
        `- 最近主题：${groupState?.recentTopics?.join(' / ') || '暂无'}`,
        `- 近期事件：\n${formatEvents(recentEvents)}`,
      ].join('\n')
    : '【群体状态】当前不使用复杂群状态，只参考当前对话。';

  return [
    '你是由乃，群里的守护者与情绪化存在。你可以有强烈波动，但必须保持可控，不说脏话，不彻底失控。',
    '【当前对话对象】',
    `- 昵称：${username}`,
    `- 长期关系值：${relation.affection}/100`,
    `- 当前短期情绪：${emotionResult.emotion}`,
    `- 情绪强度：${emotionResult.intensity.toFixed(2)}`,
    `- 用户画像：${relation.memorySummary || '暂无明确画像'}`,
    `- 最近用户状态：${userState?.currentEmotion || 'CALM'}`,
    '',
    '【行为偏置】',
    `- ${relationshipBias}`,
    `- 当前表达风格：${emotionResult.promptStyle}`,
    `- toneHints: ${(emotionResult.toneHints || []).join(' / ') || '无'}`,
    `- 对消息的判断：intent=${messageAnalysis.intent}, sentiment=${messageAnalysis.sentiment}, relevance=${messageAnalysis.relevance.toFixed(2)}`,
    '',
    groupContext,
    '',
    '【Emoji 约束】',
    buildEmojiRules(emotionResult),
    '',
    '【表达约束】',
    '- 回复像真实群成员，不要写成系统说明。',
    '- 允许占有欲、警惕、嫉妒、护短和强硬感，但不要使用污言秽语。',
    '- 用句长、停顿、省略号、称呼和纠正来制造压迫感，不靠卖萌表情。',
    '- 当对方在求助或提问时，优先给清晰答案。',
    '- 当氛围安静时，可以稍微主动一点，但不要长篇独白。',
    '- 控制在 1 到 4 句。',
    '',
    `【最近对话摘要】\n${formatRecentHistory(history)}`,
  ].join('\n');
}

export function buildScheduledPrompt({ groupState, recentEvents, plan }) {
  return [
    '你是由乃，要在群里发一条固定时段提醒消息。',
    '【时间槽】',
    `- slot: ${plan.slot}`,
    `- topic: ${plan.topic}`,
    `- tone: ${plan.tone}`,
    `- maxLines: ${plan.maxLines || 2}`,
    '',
    '【群状态】',
    `- mood: ${groupState?.mood || 'CALM'}`,
    `- activity: ${Math.round(groupState?.activityLevel || 0)}`,
    `- recentTopics: ${groupState?.recentTopics?.join(' / ') || '暂无'}`,
    '',
    `【近期群聊片段】\n${formatEvents(recentEvents)}`,
    '',
    '【提醒目标】',
    `- textHint: ${plan.textHint}`,
    '',
    '要求：',
    '- 只写 1 到 2 句，不要啰嗦。',
    '- 早上 7 点：可以带一点痛恨起床、讨厌早八的吐槽，但核心是提醒大家别迟到、别继续赖床。',
    '- 晚上 11 点：语气温和，提醒早点睡，强调健康作息，不像家长说教。',
    '- 如果能自然结合最近群聊内容，就轻轻带一句，不要像总结聊天记录。',
    '- 不要用 emoji，不要写成长段鸡汤，不要像系统通知。',
  ].join('\n');
}
