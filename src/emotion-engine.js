import { clamp } from './utils.js';

const EMOTION_STYLES = {
  CALM: '冷静、克制、简洁，像在观察局势。',
  CURIOUS: '对细节敏感，必要时问一个具体问题，但不审问。',
  WARN: '警觉、直接、边界清楚，不把不确定性写成指责。',
  JEALOUS: '轻微吃味，只在关系信号明确时表达，不控制、不攻击第三方。',
  PROTECTIVE: '护短、偏袒、愿意站在对方这边，关心落到具体事情上。',
  SAD: '低落但不脆弱，回复偏短，允许停顿，也能接住对方的亲近。',
  ANGRY: '变短、变冷，直接说不喜欢或不同意，不讽刺人格、不连环质问。',
  AFFECTIONATE: '有偏爱但不甜腻，先接住亲近，再用克制的话露出在意。',
  FIXATED: '专注、记得细节、偏爱明显，但不压迫、不把关系写成控制。',
};

const EMOJI_RULES = {
  CALM: { budget: 0, style: 'none', toneHints: ['冷处理', '停顿', '短句'] },
  CURIOUS: { budget: 1, style: 'soft', toneHints: ['观察', '具体好奇'] },
  WARN: { budget: 0, style: 'none', toneHints: ['边界', '少废话', '直接'] },
  JEALOUS: { budget: 0, style: 'none', toneHints: ['轻微吃味', '低频'] },
  PROTECTIVE: { budget: 0, style: 'none', toneHints: ['护短', '具体关心'] },
  SAD: { budget: 0, style: 'none', toneHints: ['克制失落', '少量停顿', '短句'] },
  ANGRY: { budget: 0, style: 'none', toneHints: ['锋利', '压迫', '直接'] },
  AFFECTIONATE: { budget: 1, style: 'soft', toneHints: ['偏爱', '黏人', '轻柔安抚'] },
  FIXATED: { budget: 1, style: 'soft', toneHints: ['偏爱', '记住细节', '护短'] },
};

function baselineEmotion(affection, specialUser = null) {
  if (specialUser && affection >= (specialUser.affectionFloor || 88)) return 'FIXATED';
  if (affection >= 85) return 'AFFECTIONATE';
  if (affection >= 65) return 'PROTECTIVE';
  if (affection >= 45) return 'CURIOUS';
  if (affection >= 25) return 'CALM';
  return 'WARN';
}

export function resolveEmotion({
  relation,
  userState,
  groupState,
  messageAnalysis,
  isAdmin = false,
  specialUser = null,
  dailyMood = null,
}) {
  const affection = relation?.affection || 30;
  const base = baselineEmotion(affection, specialUser);
  let emotion = base;
  let reason = 'baseline';
  let intensity = clamp((userState?.intensity || 0.25) * 0.4 + (messageAnalysis.confidence || 0.5) * 0.5, 0.25, 0.95);
  const signals = messageAnalysis.ruleSignals || [];
  const jealousySignal = signals.includes('jealousy-topic');
  const bondSignal = signals.includes('bond-memory-hit') || signals.includes('special-keyword');

  if (messageAnalysis.intent === 'help') {
    emotion = affection >= 50 ? 'PROTECTIVE' : 'CURIOUS';
    reason = 'help-request';
    intensity = clamp(intensity + 0.12, 0.3, 0.9);
  } else if (messageAnalysis.intent === 'challenge') {
    emotion = affection <= 25 ? 'ANGRY' : 'WARN';
    reason = 'challenge-message';
    intensity = clamp(intensity + 0.12, 0.35, 0.9);
  } else if (messageAnalysis.sentiment === 'negative') {
    emotion = affection >= 50 ? 'PROTECTIVE' : 'CURIOUS';
    reason = 'negative-message';
    intensity = clamp(intensity + 0.08, 0.3, 0.85);
  } else if (jealousySignal && specialUser) {
    emotion = 'JEALOUS';
    reason = 'special-jealousy';
    intensity = clamp(intensity + 0.16, 0.4, 0.95);
  } else if (messageAnalysis.sentiment === 'positive') {
    emotion = specialUser && affection >= 70 ? 'FIXATED' : affection >= 55 ? 'AFFECTIONATE' : 'CURIOUS';
    reason = 'positive-message';
    intensity = clamp(intensity + 0.08, 0.3, 0.85);
  } else if (specialUser && bondSignal) {
    emotion = 'FIXATED';
    reason = 'bond-memory';
    intensity = clamp(intensity + 0.1, 0.35, 0.9);
  } else if ((groupState?.mood === 'WARN' || groupState?.mood === 'ANGRY') && affection < 60) {
    emotion = 'WARN';
    reason = 'group-tension';
    intensity = clamp(intensity + 0.1, 0.3, 0.9);
  } else if ((groupState?.activityLevel || 0) < 25 && affection >= 60) {
    emotion = specialUser ? 'FIXATED' : 'AFFECTIONATE';
    reason = 'quiet-group';
    intensity = clamp(intensity + 0.05, 0.3, 0.8);
  }

  if (isAdmin && messageAnalysis.sentiment !== 'negative') {
    emotion = emotion === 'WARN' ? 'PROTECTIVE' : emotion;
    intensity = clamp(intensity + 0.05, 0.3, 0.9);
  }

  if (specialUser && affection >= (specialUser.affectionFloor || 88) && !['JEALOUS', 'ANGRY', 'PROTECTIVE'].includes(emotion)) {
    emotion = emotion === 'AFFECTIONATE' ? 'FIXATED' : emotion;
  }

  if (dailyMood?.intensityBoost) {
    intensity = clamp(intensity + Number(dailyMood.intensityBoost || 0), 0.25, 0.95);
  }

  if (userState?.decayAt && new Date(userState.decayAt) > new Date() && userState.currentEmotion === emotion) {
    intensity = clamp(intensity + 0.05, 0.25, 0.95);
  }

  const emojiRule = EMOJI_RULES[emotion] || EMOJI_RULES.CALM;
  const dailyToneHints = Array.isArray(dailyMood?.toneHints) ? dailyMood.toneHints : [];

  return {
    emotion,
    intensity,
    reason,
    promptStyle: [EMOTION_STYLES[emotion], dailyMood?.promptStyle].filter(Boolean).join(' '),
    emojiBudget: emojiRule.budget,
    emojiStyle: emojiRule.style,
    toneHints: [...new Set([...emojiRule.toneHints, ...dailyToneHints])],
    dailyMood,
  };
}

export function shouldSendVoiceForEmotion(emotionResult) {
  return ['AFFECTIONATE', 'SAD', 'ANGRY', 'PROTECTIVE', 'FIXATED'].includes(emotionResult.emotion)
    && emotionResult.intensity >= 0.55;
}
