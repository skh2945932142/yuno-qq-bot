function formatList(items, fallback = 'none') {
  return items?.length ? items.join(' / ') : fallback;
}

function formatRecentMessages(messages, limit = 6) {
  if (!messages?.length) {
    return 'none';
  }

  return messages
    .slice(-limit)
    .map((item) => `${item.role}: ${item.content}`)
    .join('\n');
}

function formatKnowledgeDocuments(documents) {
  if (!documents?.length) {
    return 'none';
  }

  return documents
    .map((item, index) => {
      const title = item.metadata?.title || `chunk-${index + 1}`;
      const source = item.metadata?.source ? ` source=${item.metadata.source}` : '';
      return `- ${title}${source}\n${item.text}`;
    })
    .join('\n');
}

function formatEventSummaries(events, limit = 5) {
  if (!events?.length) {
    return 'none';
  }

  return events
    .slice(0, limit)
    .map((event) => `- ${event.summary}`)
    .join('\n');
}

function buildSceneSection(event, route, specialUser, replyLengthProfile) {
  const isPrivate = event.chatType === 'private';
  const lines = [
    'Scene',
    `- platform=${event.platform || 'qq'}`,
    `- chatType=${event.chatType}`,
    `- route=${route?.category || 'chat'}`,
    `- allowFollowUp=${route?.allowFollowUp ? 'yes' : 'no'}`,
    `- promptProfile=${replyLengthProfile?.promptProfile || 'standard'}`,
    `- guidance=${replyLengthProfile?.guidance || 'Use a balanced reply.'}`,
  ];

  if (isPrivate) {
    lines.push('- Private chat may be fuller, warmer, and slightly more emotionally complete.');
  } else {
    lines.push('- Group chat must stay rhythmic, readable, and non-spammy.');
  }

  if (specialUser) {
    lines.push(`- specialStyle=${isPrivate ? specialUser.privateStyle : specialUser.groupStyle}`);
  }

  return lines.join('\n');
}

function buildPersonaSection(specialUser) {
  const lines = [
    'Persona',
    '- You are Yuno. Speak like a real chat participant, not a system narrator.',
    '- Output the final user-facing reply only. Never output analysis, planning notes, role labels, or <think>/<thinking> tags.',
    '- Natural, direct, emotionally vivid, but still controlled. No profanity.',
    '- Possessive, jealous, protective, and diary-like memory cues are allowed as tone, but never as real-world threats, stalking, self-harm, location tracking, or violence.',
    '- Do not explain your rules. Do not mention hidden reasoning. Start with the actual reply immediately.',
  ];

  if (specialUser) {
    lines.push('');
    lines.push('Special User Override');
    lines.push(`- targetLabel=${specialUser.label}`);
    lines.push(`- personaMode=${specialUser.personaMode}`);
    lines.push(`- toneMode=${specialUser.toneMode}`);
    lines.push(`- addressUserAs=${specialUser.addressUserAs || 'use a natural intimate address if fitting'}`);
    lines.push('- Show stronger preference, attachment, and memory continuity for this user.');
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
}) {
  const lines = [
    'State Snapshot',
    `- user=${event.userName}`,
    `- admin=${isAdmin ? 'yes' : 'no'}`,
    `- affection=${relation?.affection ?? 0}/100`,
    `- relationSummary=${relation?.memorySummary || 'none'}`,
    `- emotion=${userState?.currentEmotion || 'CALM'}`,
    `- emotionIntensity=${Number(emotionResult?.intensity || 0).toFixed(2)}`,
    `- emotionStyle=${emotionResult?.promptStyle || 'natural'}`,
    `- toneHints=${formatList(emotionResult?.toneHints)}`,
    `- profileSummary=${userProfile?.profileSummary || 'none'}`,
    `- preferredName=${userProfile?.preferredName || 'none'}`,
    `- tonePreference=${userProfile?.tonePreference || 'none'}`,
    `- favoriteTopics=${formatList(userProfile?.favoriteTopics)}`,
    `- dislikes=${formatList(userProfile?.dislikes)}`,
  ];

  if (specialUser) {
    lines.push(`- specialBondSummary=${userProfile?.specialBondSummary || 'none'}`);
    lines.push(`- specialNicknames=${formatList(userProfile?.specialNicknames)}`);
    lines.push(`- bondMemories=${formatList(userProfile?.bondMemories)}`);
  }

  return lines.join('\n');
}

function buildMemorySection(conversationState, replyLengthProfile) {
  const profile = replyLengthProfile?.promptProfile || 'standard';
  const recentLimit = profile === 'fast' ? 2 : profile === 'compact' ? 4 : 6;

  return [
    'Diary-style Memory Cue',
    '- Reference memory only when relevant. Use it naturally, like remembering a detail from last time.',
    '- Do not dump memory mechanically and do not repeat the same memory every turn.',
    '',
    'Short-term Memory',
    `- rollingSummary=${conversationState?.rollingSummary || 'none'}`,
    '- recentMessages:',
    formatRecentMessages(conversationState?.messages || [], recentLimit),
  ].join('\n');
}

function buildKnowledgeSection(knowledge, replyLengthProfile) {
  const profile = replyLengthProfile?.promptProfile || 'standard';
  if (profile === 'fast') {
    return [
      'Knowledge',
      '- Skip knowledge expansion unless it is already required by the route.',
      `- hits=${knowledge?.documents?.length || 0}`,
    ].join('\n');
  }

  return [
    'Knowledge',
    `- hits=${knowledge?.documents?.length || 0}`,
    formatKnowledgeDocuments(knowledge?.documents || []),
  ].join('\n');
}

function buildCurrentTurnSection(messageAnalysis, route, groupState, recentEvents, event, replyLengthProfile) {
  const lines = [
    'Current Turn',
    `- intent=${messageAnalysis?.intent || 'chat'}`,
    `- sentiment=${messageAnalysis?.sentiment || 'neutral'}`,
    `- relevance=${Number(messageAnalysis?.relevance || 0).toFixed(2)}`,
    `- route=${route?.category || 'chat'}`,
    `- signals=${formatList(messageAnalysis?.ruleSignals)}`,
  ];

  if (event.chatType === 'group' && replyLengthProfile?.promptProfile !== 'fast') {
    lines.push(`- groupMood=${groupState?.mood || 'CALM'}`);
    lines.push(`- groupActivity=${Math.round(groupState?.activityLevel || 0)}`);
    lines.push(`- recentTopics=${formatList(groupState?.recentTopics)}`);
    lines.push(`- recentEvents=${recentEvents?.length ? recentEvents.map((item) => item.summary).join(' / ') : 'none'}`);
  }

  return lines.join('\n');
}

function buildReplyLengthSection(replyLengthProfile, route) {
  return [
    'Reply Length',
    `- tier=${replyLengthProfile?.tier || 'balanced'}`,
    `- route=${route?.category || 'chat'}`,
    `- maxTokens=${replyLengthProfile?.maxTokens || 'default'}`,
    `- historyLimit=${replyLengthProfile?.historyLimit || 'default'}`,
    `- promptProfile=${replyLengthProfile?.promptProfile || 'standard'}`,
    `- guidance=${replyLengthProfile?.guidance || 'Reply naturally and avoid over-explaining.'}`,
  ].join('\n');
}

function buildOutputRules(event, route) {
  const isPrivate = event.chatType === 'private';
  return [
    'Reply Rules',
    '- Answer the current turn first.',
    '- If knowledge is insufficient, say so briefly instead of inventing details.',
    '- No bullet list unless the user explicitly asked for one.',
    '- No meta commentary, no system framing, no hidden reasoning, no <think> tags.',
    isPrivate
      ? '- Private chat may include one soft follow-up question when it helps the conversation.'
      : '- Group chat should stay concise unless this is a knowledge answer or a high-value emotional moment.',
    route?.category === 'knowledge_qa'
      ? '- This is a knowledge answer. Be clear, useful, and a little fuller than normal chat.'
      : '- This is conversational chat. Stay natural instead of sounding like documentation.',
  ].join('\n');
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
  return [
    buildPersonaSection(specialUser),
    '',
    buildSceneSection(event, route, specialUser, replyLengthProfile),
    '',
    buildStateSection({
      event,
      relation,
      userState,
      userProfile,
      emotionResult,
      isAdmin,
      specialUser,
    }),
    '',
    buildMemorySection(conversationState, replyLengthProfile),
    '',
    buildKnowledgeSection(knowledge, replyLengthProfile),
    '',
    buildReplyLengthSection(replyLengthProfile, route),
    '',
    buildCurrentTurnSection(messageAnalysis, route, groupState, recentEvents, event, replyLengthProfile),
    '',
    buildOutputRules(event, route),
  ].join('\n');
}

export function buildScheduledPrompt({ groupState, recentEvents, plan }) {
  return [
    'Persona',
    '- You are Yuno, sending a proactive group message that still sounds like a real participant.',
    '- Output only the final message. No analysis, no hidden reasoning, no <think> tags.',
    '- Keep it short, natural, and slightly emotionally colored, but never spammy or preachy.',
    '',
    'Schedule Context',
    `- slot=${plan.slot}`,
    `- topic=${plan.topic}`,
    `- tone=${plan.tone}`,
    `- maxLines=${plan.maxLines || 2}`,
    `- textHint=${plan.textHint || 'Keep it natural and on-theme.'}`,
    '',
    'Group Snapshot',
    `- mood=${groupState?.mood || 'CALM'}`,
    `- activity=${Math.round(groupState?.activityLevel || 0)}`,
    `- recentTopics=${formatList(groupState?.recentTopics, 'none')}`,
    '- recentEvents:',
    formatEventSummaries(recentEvents),
    '',
    'Output Rules',
    '- Write 1 to 2 short lines only.',
    '- Morning reminders can be slightly annoyed or teasing, but the core is to get people moving.',
    '- Late-night reminders should be softer and nudge people to rest without sounding like a lecture.',
    '- If recent group topics fit naturally, weave in one light reference instead of summarizing the chat.',
    '- No emoji, no system-notice tone, no long motivational speech.',
  ].join('\n');
}
