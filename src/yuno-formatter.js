function formatList(items, fallback = '暂无') {
  return Array.isArray(items) && items.length > 0 ? items.join(' / ') : fallback;
}

function pickLabel(policy = {}) {
  if (policy.specialUser?.addressUserAs) {
    return policy.specialUser.addressUserAs;
  }
  return '你';
}

export function buildStructuredToolResult({
  tool,
  payload = {},
  summary = '',
  priority = 'normal',
  visibility = 'default',
  followUpHint = '',
  templateType = 'utility',
  safetyFlags = [],
}) {
  return {
    tool,
    payload,
    summary,
    priority,
    visibility,
    followUpHint,
    templateType,
    safetyFlags,
  };
}

function renderStatusReply(toolResult, policy) {
  const payload = toolResult.payload || {};
  const prefix = policy.specialUser ? '我替你仔细看过了。' : '我刚替你看了一眼。';

  switch (toolResult.tool) {
    case 'get_relation':
      return `${prefix}现在的好感是 ${payload.affection ?? '未知'}/100，情绪偏向 ${payload.currentEmotion || 'CALM'}。`;
    case 'get_emotion':
      return `${prefix}现在的情绪是 ${payload.emotion || 'CALM'}，强度大约 ${Number(payload.intensity || 0).toFixed(2)}。`;
    case 'get_group_state':
      return `${prefix}群里的气氛偏 ${payload.mood || 'CALM'}，活跃度 ${Math.round(Number(payload.activityLevel || 0))}，最近常提的话题是 ${formatList(payload.recentTopics)}。`;
    case 'get_profile':
      return `${prefix}${payload.memorySummary || '稳定画像还不够多，我还在慢慢记。'}`;
    case 'get_help':
      return `${prefix}现在能直接叫我的命令有：${formatList(payload.commands)}。`;
    default:
      return toolResult.summary || '这件事我先替你记下了。';
  }
}

function renderReportReply(toolResult, policy) {
  const payload = toolResult.payload || {};

  if (toolResult.tool === 'group_report') {
    const topUser = payload.topUsers?.[0];
    const topTopic = payload.topTopics?.[0];
    const prefix = policy.specialUser ? '我替你把群里的动静理了一遍。' : '我把群里的动静理了一遍。';
    let text = `${prefix}最近 ${payload.windowHours || 24} 小时里，一共出现了 ${payload.totalMessages || 0} 条消息，活跃了 ${payload.activeUsers || 0} 个人。`;
    if (topUser) {
      text += ` 最活跃的是 ${topUser.name}，一共冒头 ${topUser.count} 次。`;
    }
    if (topTopic) {
      text += ` 聊得最热的是 ${topTopic.name}。`;
    }
    if (payload.anomalies?.length) {
      text += ` 我还记到了 ${payload.anomalies.length} 个异常波动。`;
    }
    return text;
  }

  if (toolResult.tool === 'activity_leaderboard') {
    const leaders = (payload.leaders || []).map((entry, index) => `#${index + 1} ${entry.name} (${entry.count})`).join('、');
    return leaders
      ? `最近的活跃榜我排好了：${leaders}。`
      : '这段时间还没有足够的活跃榜数据。';
  }

  if (toolResult.tool === 'group_daily_digest') {
    const leaders = (payload.topUsers || []).map((entry) => `${entry.name}(${entry.count})`).join('、');
    const topics = (payload.topTopics || []).map((entry) => entry.name).join('、');
    return `今天的群摘要我收好了：一共 ${payload.totalMessages || 0} 条消息，活跃了 ${payload.activeUsers || 0} 个人。最常冒头的是 ${leaders || '暂无'}，最热的话题是 ${topics || '暂无'}。`;
  }

  return toolResult.summary || '报告我已经替你理好了。';
}

function renderWatchReply(toolResult) {
  const payload = toolResult.payload || {};
  if (toolResult.tool === 'keyword_watch_added') {
    return `这个关键词我替你盯住了：${payload.pattern || payload.keyword}。真碰上时，我会提醒。`;
  }
  if (toolResult.tool === 'keyword_watch_removed') {
    return payload.removed
      ? `这个关键词我已经不再盯了：${payload.keyword}。`
      : `我没找到还在生效的关键词盯梢：${payload.keyword}。`;
  }
  if (toolResult.tool === 'keyword_watch_list') {
    const rules = payload.rules || [];
    return rules.length > 0
      ? `现在还挂着这些关键词盯梢：${rules.map((rule) => rule.pattern).join('、')}。`
      : '现在还没有挂着的关键词盯梢。';
  }
  if (toolResult.tool === 'automation_keyword_alert') {
    return `${payload.username || '有人'}刚刚提到了“${payload.keyword}”。我顺手记下的内容是：${payload.summary || '暂无'}。`;
  }
  return toolResult.summary || '盯梢规则我已经替你收好了。';
}

function renderReminderReply(toolResult, policy) {
  const payload = toolResult.payload || {};
  const address = pickLabel(policy);
  if (toolResult.tool === 'reminder_created') {
    const delay = payload.payload?.delayMinutes || payload.delayMinutes || '过一会儿';
    const text = payload.payload?.text || payload.text;
    return text
      ? `好，我会在 ${delay} 分钟后提醒${address}：${text}。`
      : `好，我会在 ${delay} 分钟后提醒${address}。`;
  }
  if (toolResult.tool === 'reminder_list') {
    const tasks = payload.tasks || [];
    return tasks.length > 0
      ? `${address}现在还挂着 ${tasks.length} 个提醒：${tasks.map((task) => `${task.taskId}（${task.summary}）`).join('、')}。`
      : `${address}现在没有挂着的提醒。`;
  }
  if (toolResult.tool === 'reminder_cancelled') {
    return payload.cancelled
      ? `提醒 ${payload.taskId} 我已经替${address}撤掉了。`
      : `我没找到编号为 ${payload.taskId} 的提醒。`;
  }
  if (toolResult.tool === 'reminder_due') {
    return `到时间了。${payload.text || payload.summary || '你要我记着的事，我没有忘。'}`;
  }
  return toolResult.summary || '提醒这件事我已经替你理好了。';
}

function renderSubscriptionReply(toolResult) {
  const payload = toolResult.payload || {};
  if (toolResult.tool === 'subscription_created') {
    return `这条订阅我记下了：${payload.payload?.sourceType || payload.sourceType} / ${payload.payload?.target || payload.target}，每 ${payload.repeatIntervalMinutes || payload.intervalMinutes} 分钟看一遍。`;
  }
  if (toolResult.tool === 'subscription_list') {
    const tasks = payload.tasks || [];
    return tasks.length > 0
      ? `现在挂着的订阅有这些：${tasks.map((task) => `${task.taskId}（${task.sourceType}:${task.target}）`).join('、')}。`
      : '现在没有生效中的订阅。';
  }
  if (toolResult.tool === 'subscription_cancelled') {
    return payload.cancelled
      ? `订阅 ${payload.taskId} 我已经替你停掉了。`
      : `我没找到编号为 ${payload.taskId} 的订阅。`;
  }
  if (toolResult.tool === 'subscription_update') {
    return `${payload.summary || '我替你盯着的订阅刚刚有了动静。'}${payload.actionSuggestion ? ` ${payload.actionSuggestion}` : ''}`;
  }
  return toolResult.summary || '订阅这件事我已经替你安顿好了。';
}

function renderMemeReply(toolResult, policy) {
  const action = toolResult.payload?.action || 'idle';

  if (action === 'collect') {
    return policy.specialUser
      ? '这张梗图素材我替你单独留着了。'
      : '这张梗图素材我先收进库里了。';
  }

  if (action === 'send-existing') {
    return policy.specialUser
      ? '这一张正合现在的气氛，我替你挑出来了。'
      : '这一张刚好合适。';
  }

  if (action === 'generate-quote') {
    return policy.specialUser
      ? '那句话我已经替你做成图了，气氛一点都没丢。'
      : '那句话我已经替你做成梗图了。';
  }

  return toolResult.summary || '这次先不发图，我替你压住了。';
}

function renderKnowledgeReply(toolResult, policy) {
  if (toolResult.summary) {
    return policy.specialUser
      ? `我替你把关键点理好了：${toolResult.summary}`
      : toolResult.summary;
  }

  return policy.specialUser
    ? '我替你把最相关的那部分整理出来了。'
    : '我把最相关的那部分整理出来了。';
}

function renderScheduleReply(toolResult, policy) {
  const reminderText = toolResult.payload?.text || '那件事';
  return policy.specialUser
    ? `${reminderText}我已经记住了，会替你一直放在心上。`
    : `${reminderText}我已经记住了。`;
}

function renderWelcomeReply(toolResult) {
  const customMessage = String(toolResult.payload?.customMessage || '').trim();
  if (customMessage) {
    return customMessage;
  }
  return `欢迎你，${toolResult.payload?.username || '新成员'}。先慢慢熟悉这里，气氛这边我会替你看着。`;
}

export function formatToolResultAsYuno(toolResult, policy = {}) {
  if (!toolResult) {
    return '这件事我先替你记下了。';
  }

  if (toolResult.tool?.startsWith('get_')) {
    return renderStatusReply(toolResult, policy);
  }

  if (['group_report', 'activity_leaderboard', 'group_daily_digest'].includes(toolResult.tool)) {
    return renderReportReply(toolResult, policy);
  }

  if (toolResult.tool?.includes('keyword_watch') || toolResult.tool === 'automation_keyword_alert') {
    return renderWatchReply(toolResult, policy);
  }

  if (toolResult.tool?.startsWith('reminder_')) {
    return renderReminderReply(toolResult, policy);
  }

  if (toolResult.tool?.startsWith('subscription_')) {
    return renderSubscriptionReply(toolResult, policy);
  }

  if (toolResult.tool === 'automation_welcome') {
    return renderWelcomeReply(toolResult, policy);
  }

  if (toolResult.tool?.startsWith('meme_')) {
    return renderMemeReply(toolResult, policy);
  }

  if (toolResult.tool === 'knowledge_lookup') {
    return renderKnowledgeReply(toolResult, policy);
  }

  if (toolResult.tool === 'schedule_note') {
    return renderScheduleReply(toolResult, policy);
  }

  return toolResult.summary || '这件事我先替你记下了。';
}

export function normalizeFormatterOutputs(toolResult, text) {
  const outputs = [];

  if (text) {
    outputs.push({ type: 'text', text });
  }

  const payload = toolResult?.payload || {};

  if (payload.image) {
    outputs.push({
      type: 'image',
      image: payload.image,
    });
  }

  if (Array.isArray(payload.images)) {
    for (const image of payload.images) {
      outputs.push({
        type: 'image',
        image,
      });
    }
  }

  return outputs;
}

export function summarizeToolPayload(toolResult) {
  const payload = toolResult?.payload || {};

  if (toolResult?.tool === 'meme_collect') {
    return `已收下一张梗图素材，标签：${formatList(payload.tags, '未标记')}`;
  }

  if (toolResult?.tool === 'meme_retrieve') {
    return `匹配到梗图素材 ${payload.assetId || '未知编号'}`;
  }

  if (toolResult?.tool === 'group_report') {
    return `${payload.totalMessages || 0} 条消息 / ${payload.activeUsers || 0} 人活跃`;
  }

  return toolResult?.summary || '';
}
