function formatList(items, fallback = 'none') {
  return Array.isArray(items) && items.length > 0 ? items.join(' / ') : fallback;
}

export function buildStructuredToolResult({
  tool,
  payload = {},
  summary = '',
  visibility = 'default',
  safetyFlags = [],
}) {
  return {
    tool,
    payload,
    summary,
    visibility,
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
      return `${prefix} Group mood is ${payload.mood || 'CALM'}, activity level ${Math.round(Number(payload.activityLevel || 0))}.`;
    case 'get_profile':
      return `${prefix} Profile summary: ${payload.memorySummary || 'No stable profile data yet.'}`;
    default:
      return toolResult.summary || 'Done.';
  }
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
      ? `I整理好了重点: ${toolResult.summary}`
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

export function formatToolResultAsYuno(toolResult, policy = {}) {
  if (!toolResult) {
    return 'Done.';
  }

  if (toolResult.tool?.startsWith('get_')) {
    return renderStatusReply(toolResult, policy);
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

  return toolResult?.summary || '';
}
