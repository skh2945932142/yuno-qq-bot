function formatList(items, fallback = '暂无') {
  return Array.isArray(items) && items.length > 0 ? items.join(' / ') : fallback;
}

function pickLabel(policy = {}) {
  if (policy.specialUser?.addressUserAs) {
    return policy.specialUser.addressUserAs;
  }
  return '你';
}

function compactReason(value, fallback = 'unknown') {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length <= 48 ? normalized : `${normalized.slice(0, 47)}…`;
}

function hasEmptyPayload(toolResult) {
  const payload = toolResult?.payload || {};
  if (payload.empty === true || payload.count === 0 || payload.total === 0) {
    return true;
  }
  if (Array.isArray(payload.items) && payload.items.length === 0) return true;
  if (Array.isArray(payload.results) && payload.results.length === 0) return true;
  if (Array.isArray(payload.documents) && payload.documents.length === 0) return true;
  return false;
}
const ROBOTIC_TOOL_ACKNOWLEDGEMENT_REGEX = /(?:我(?:(?:已经|会|先|都|也|替你)\s*)*(?:记下|记住|记着|收下|接住)(?:了|啦|这句|这件事|你(?:这句|说的(?:话|内容)))?|这(?:句|句话|件事|条(?:偏好|订阅|提醒)?)(?:我)?(?:(?:已经|会|先|都|也|替你)\s*)*(?:记下|记住|记着|收下|接住)(?:了|啦)?|我(?:听见|听到|知道|明白|了解)(?:了|啦)|提醒已经记下(?:了)?|(?:(?:已经|都|这就)\s*)?(?:记下|记住|收下|接住)(?:了|啦)|(?:已经|已)?收到(?:了|啦)?)/;

function sanitizeToolAcknowledgement(text, toolResult = {}) {
  const value = String(text || '').trim();
  if (!value || !ROBOTIC_TOOL_ACKNOWLEDGEMENT_REGEX.test(value)) return value;

  const detail = value.includes('：') ? value.split('：').slice(1).join('：').trim() : '';
  const tool = String(toolResult?.tool || '');
  if (tool.startsWith('reminder_') || tool === 'schedule_note') {
    return detail ? `好。${detail}` : '好，到时间我会叫你。';
  }
  if (tool.startsWith('subscription_')) {
    return detail ? `订阅开始了：${detail}` : '好，之后我会按这个频率看。';
  }
  if (tool.startsWith('meme_')) {
    return detail ? `表情包这边会按这个来：${detail}` : '之后会按这个表情包偏好来。';
  }
  if (tool.startsWith('memory_') || tool.startsWith('style_')) {
    return detail ? `之后会按这个偏好来：${detail}` : '之后会按这个偏好来。';
  }
  return detail ? `好，之后按这个来：${detail}` : '好，之后按这个来。';
}


function renderExceptionalToolReply(toolResult, policy = {}) {
  const payload = toolResult?.payload || {};
  const flags = new Set([
    ...(Array.isArray(toolResult?.safetyFlags) ? toolResult.safetyFlags : []),
    ...(Array.isArray(payload.safetyFlags) ? payload.safetyFlags : []),
  ]);
  const status = String(toolResult?.status || payload.status || '').toLowerCase();
  const reason = compactReason(toolResult?.error || payload.error || payload.reason || toolResult?.reason, '');
  const toolName = toolResult?.tool || 'tool';

  if (flags.has('permission-denied') || status === 'permission_denied' || /requires admin|权限|permission/i.test(reason)) {
    return `这个我不能直接替${pickLabel(policy)}做，权限不在我手里。${reason ? `边界是：${reason}。` : ''}`.trim();
  }

  if (flags.has('timeout') || status === 'timeout' || /timeout|timed out|超时/i.test(reason)) {
    return reason
      ? `这一步刚才卡住了，我先不乱说。原因是：${reason}。`
      : '这一步刚才卡住了，我先不乱说。你再发一次，我重新接。';
  }

  if (flags.has('knowledge-empty') || status === 'knowledge_empty' || (toolName === 'knowledge_lookup' && hasEmptyPayload(toolResult))) {
    return toolResult.summary
      ? `我只查到这点：${toolResult.summary}`
      : '这部分我没查到可靠依据，不想骗你。';
  }

  if (flags.has('tool-empty') || status === 'empty' || hasEmptyPayload(toolResult)) {
    return toolResult.summary || '我翻过了，但这次没有拿到可用结果。';
  }

  if (flags.has('tool-error') || status === 'error' || toolResult?.ok === false || payload.ok === false) {
    return reason
      ? `这一步没跑稳，我先停住。原因是：${reason}。`
      : '这一步没跑稳，我先停住，不把没确认的结果讲给你。';
  }

  return '';
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
      return `${prefix}${payload.memorySummary || '稳定画像还不够多，还得再聊一阵。'}`;
    case 'get_memory':
      return `${prefix}${toolResult.summary || '我现在还没攒到足够稳定的记忆。'}`;
    case 'get_style':
      return `${prefix}${toolResult.summary || '我还没读到很稳定的说话风格偏好。'}`;
    case 'get_help':
      return `${prefix}现在能直接叫我的命令有：${formatList(payload.commands)}。`;
    default:
      return toolResult.summary || '这部分暂时没有可展示的内容。';
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
    return `${payload.username || '有人'}刚刚提到了“${payload.keyword}”。相关内容是：${payload.summary || '暂无'}。`;
  }
  return toolResult.summary || '盯梢规则已经生效。';
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
    return `到时间了。${payload.text || payload.summary || '你交代的事，我没忘。'}`;
  }
  return toolResult.summary || '提醒这件事我已经替你理好了。';
}

function renderSubscriptionReply(toolResult) {
  const payload = toolResult.payload || {};
  if (toolResult.tool === 'subscription_created') {
    return `订阅开始了：${payload.payload?.sourceType || payload.sourceType} / ${payload.payload?.target || payload.target}，每 ${payload.repeatIntervalMinutes || payload.intervalMinutes} 分钟看一遍。`;
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

  if (toolResult.tool === 'meme_search') {
    const count = Number(toolResult.payload?.count || 0);
    return count > 0
      ? `我翻了一下，挑出 ${count} 张可能合现在气氛的表情包。`
      : toolResult.summary || '我暂时没找到合适的表情包。';
  }

  if (toolResult.tool === 'meme_optout') {
    return toolResult.summary || '之后会按这个表情包偏好来。';
  }

  if (action === 'collect') {
    return policy.specialUser
      ? '这张梗图素材我替你单独留着了。'
      : '这张梗图素材之后可以直接用。';
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
  if (hasEmptyPayload(toolResult) && !toolResult.summary) {
    return '这部分我没查到可靠依据，不想骗你。';
  }

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
    ? `${reminderText}。到时候我会提醒你，不会让它悄悄过去。`
    : `${reminderText}。到时候我会提醒你。`;
}

function renderWelcomeReply(toolResult) {
  const customMessage = String(toolResult.payload?.customMessage || '').trim();
  if (customMessage) {
    return customMessage;
  }
  return `欢迎你，${toolResult.payload?.username || '新成员'}。先慢慢熟悉这里，气氛这边我会替你看着。`;
}

function formatToolResultAsYunoRaw(toolResult, policy = {}) {
  if (!toolResult) {
    return '好，之后按这个来。';
  }

  const exceptionalReply = renderExceptionalToolReply(toolResult, policy);
  if (exceptionalReply) {
    return exceptionalReply;
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

  if (toolResult.tool?.startsWith('memory_') || toolResult.tool?.startsWith('style_')) {
    return toolResult.summary || '之后会按这条偏好来。';
  }

  if (toolResult.tool === 'debug_why') {
    return toolResult.summary || '这轮调试信息我暂时没拿到。';
  }

  if (toolResult.tool === 'knowledge_lookup') {
    return renderKnowledgeReply(toolResult, policy);
  }

  if (toolResult.tool === 'schedule_note') {
    return renderScheduleReply(toolResult, policy);
  }

  return toolResult.summary || '好，之后按这个来。';
}

export function formatToolResultAsYuno(toolResult, policy = {}) {
  return sanitizeToolAcknowledgement(formatToolResultAsYunoRaw(toolResult, policy), toolResult);
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
    return `梗图素材可用，标签：${formatList(payload.tags, '未标记')}`;
  }

  if (toolResult?.tool === 'meme_retrieve') {
    return `匹配到梗图素材 ${payload.assetId || '未知编号'}`;
  }

  if (toolResult?.tool === 'group_report') {
    return `${payload.totalMessages || 0} 条消息 / ${payload.activeUsers || 0} 人活跃`;
  }

  return toolResult?.summary || '';
}
