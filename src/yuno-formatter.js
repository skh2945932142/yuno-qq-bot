function formatList(items, fallback = 'none') {
  return Array.isArray(items) && items.length > 0 ? items.join(' / ') : fallback;
}

function pickLabel(policy = {}) {
  if (policy.specialUser?.addressUserAs) {
    return policy.specialUser.addressUserAs;
  }
  return policy.specialUser ? 'you' : 'everyone';
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
  const prefix = policy.specialUser ? 'I checked it for you.' : 'I checked the current state.';

  switch (toolResult.tool) {
    case 'get_relation':
      return `${prefix} Affection is ${payload.affection ?? 'unknown'}/100, and the current emotion is ${payload.currentEmotion || 'CALM'}.`;
    case 'get_emotion':
      return `${prefix} Current emotion is ${payload.emotion || 'CALM'} with intensity ${Number(payload.intensity || 0).toFixed(2)}.`;
    case 'get_group_state':
      return `${prefix} Group mood is ${payload.mood || 'CALM'}, activity level ${Math.round(Number(payload.activityLevel || 0))}, recent topics ${formatList(payload.recentTopics, 'none')}.`;
    case 'get_profile':
      return `${prefix} Profile summary: ${payload.memorySummary || 'No stable profile data yet.'}`;
    case 'get_help':
      return `${prefix} Available commands: ${formatList(payload.commands, 'none')}.`;
    default:
      return toolResult.summary || 'Done.';
  }
}

function renderReportReply(toolResult, policy) {
  const payload = toolResult.payload || {};

  if (toolResult.tool === 'group_report') {
    const topUser = payload.topUsers?.[0];
    const topTopic = payload.topTopics?.[0];
    const prefix = policy.specialUser ? 'I sorted the group report for you.' : 'I sorted the group report.';
    let text = `${prefix} In the last ${payload.windowHours || 24} hours, there were ${payload.totalMessages || 0} messages from ${payload.activeUsers || 0} active users.`;
    if (topUser) {
      text += ` Most active: ${topUser.name} (${topUser.count}).`;
    }
    if (topTopic) {
      text += ` Hottest topic: ${topTopic.name}.`;
    }
    if (payload.anomalies?.length) {
      text += ` I also noticed ${payload.anomalies.length} anomaly signal(s).`;
    }
    return text;
  }

  if (toolResult.tool === 'activity_leaderboard') {
    const leaders = (payload.leaders || []).map((entry, index) => `#${index + 1} ${entry.name} (${entry.count})`).join(', ');
    return leaders
      ? `Here is the recent activity leaderboard: ${leaders}.`
      : 'There is no activity leaderboard data yet.';
  }

  if (toolResult.tool === 'group_daily_digest') {
    const leaders = (payload.topUsers || []).map((entry) => `${entry.name}(${entry.count})`).join(', ');
    const topics = (payload.topTopics || []).map((entry) => entry.name).join(', ');
    return `Daily digest: ${payload.totalMessages || 0} messages, ${payload.activeUsers || 0} active users. Top people: ${leaders || 'none'}. Top topics: ${topics || 'none'}.`;
  }

  return toolResult.summary || 'The report is ready.';
}

function renderWatchReply(toolResult) {
  const payload = toolResult.payload || {};
  if (toolResult.tool === 'keyword_watch_added') {
    return `I will watch "${payload.pattern || payload.keyword}" here. I will only nudge when it matters.`;
  }
  if (toolResult.tool === 'keyword_watch_removed') {
    return payload.removed
      ? `I stopped watching "${payload.keyword}".`
      : `I could not find an active watch for "${payload.keyword}".`;
  }
  if (toolResult.tool === 'keyword_watch_list') {
    const rules = payload.rules || [];
    return rules.length > 0
      ? `Current keyword watches: ${rules.map((rule) => rule.pattern).join(', ')}.`
      : 'There are no keyword watches right now.';
  }
  if (toolResult.tool === 'automation_keyword_alert') {
    return `${payload.username || 'Someone'} mentioned "${payload.keyword}". Summary: ${payload.summary || 'no summary'}.`;
  }
  return toolResult.summary || 'Watch rule updated.';
}

function renderReminderReply(toolResult, policy) {
  const payload = toolResult.payload || {};
  const address = pickLabel(policy);
  if (toolResult.tool === 'reminder_created') {
    return `Noted, ${address}. I will remind you in ${payload.payload?.delayMinutes || payload.delayMinutes || 'a while'} minute(s).`;
  }
  if (toolResult.tool === 'reminder_list') {
    const tasks = payload.tasks || [];
    return tasks.length > 0
      ? `You still have ${tasks.length} reminder(s): ${tasks.map((task) => `${task.taskId}(${task.summary})`).join(', ')}.`
      : 'You do not have any pending reminders.';
  }
  if (toolResult.tool === 'reminder_cancelled') {
    return payload.cancelled
      ? `Reminder ${payload.taskId} has been cancelled.`
      : `I could not find reminder ${payload.taskId}.`;
  }
  if (toolResult.tool === 'reminder_due') {
    return `Reminder time. ${payload.text || payload.summary || 'Do not forget what you asked me to keep in mind.'}`;
  }
  return toolResult.summary || 'Reminder updated.';
}

function renderSubscriptionReply(toolResult) {
  const payload = toolResult.payload || {};
  if (toolResult.tool === 'subscription_created') {
    return `Subscription created for ${payload.payload?.sourceType || payload.sourceType} ${payload.payload?.target || payload.target} every ${payload.repeatIntervalMinutes || payload.intervalMinutes} minute(s).`;
  }
  if (toolResult.tool === 'subscription_list') {
    const tasks = payload.tasks || [];
    return tasks.length > 0
      ? `Current subscriptions: ${tasks.map((task) => `${task.taskId}(${task.sourceType}:${task.target})`).join(', ')}.`
      : 'There are no active subscriptions.';
  }
  if (toolResult.tool === 'subscription_cancelled') {
    return payload.cancelled
      ? `Subscription ${payload.taskId} has been cancelled.`
      : `I could not find subscription ${payload.taskId}.`;
  }
  if (toolResult.tool === 'subscription_update') {
    return `${payload.summary || 'A subscribed event matched.'}${payload.actionSuggestion ? ` ${payload.actionSuggestion}` : ''}`;
  }
  return toolResult.summary || 'Subscription updated.';
}

function renderMemeReply(toolResult, policy) {
  const action = toolResult.payload?.action || 'idle';

  if (action === 'collect') {
    return policy.specialUser
      ? 'I kept that meme asset aside for you.'
      : 'I stored that meme asset for later.';
  }

  if (action === 'send-existing') {
    return policy.specialUser
      ? 'This one fits the moment. I picked it for you.'
      : 'This meme fits the moment.';
  }

  if (action === 'generate-quote') {
    return policy.specialUser
      ? 'I turned that line into an image and kept the mood intact.'
      : 'I turned that line into a meme image.';
  }

  return toolResult.summary || 'Skipping the meme this time.';
}

function renderKnowledgeReply(toolResult, policy) {
  if (toolResult.summary) {
    return policy.specialUser
      ? `I sorted the key points for you: ${toolResult.summary}`
      : toolResult.summary;
  }

  return policy.specialUser
    ? 'I pulled together the most relevant notes for you.'
    : 'I pulled together the most relevant notes.';
}

function renderScheduleReply(toolResult, policy) {
  const reminderText = toolResult.payload?.text || 'that reminder';
  return policy.specialUser
    ? `I noted ${reminderText}. I will keep it in mind.`
    : `I noted ${reminderText}.`;
}

function renderWelcomeReply(toolResult) {
  const customMessage = String(toolResult.payload?.customMessage || '').trim();
  if (customMessage) {
    return customMessage;
  }
  return `Welcome, ${toolResult.payload?.username || 'new member'}. Settle in first; I will keep an eye on the mood here.`;
}

export function formatToolResultAsYuno(toolResult, policy = {}) {
  if (!toolResult) {
    return 'Done.';
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

  return toolResult.summary || 'Done.';
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
    return `Collected meme asset with tags ${formatList(payload.tags, 'untagged')}`;
  }

  if (toolResult?.tool === 'meme_retrieve') {
    return `Matched meme asset ${payload.assetId || 'unknown'}`;
  }

  if (toolResult?.tool === 'group_report') {
    return `${payload.totalMessages || 0} messages / ${payload.activeUsers || 0} active users`;
  }

  return toolResult?.summary || '';
}
