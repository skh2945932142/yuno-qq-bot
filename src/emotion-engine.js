import { clamp } from './utils.js';

const EMOTION_STYLES = {
  CALM: '冷静、克制、简洁，像在观察局势。',
  CURIOUS: '会追问细节，但不过分热情。',
  WARN: '带警觉和压迫感，语气收紧，不给人太轻松的感觉。',
  JEALOUS: '占有欲明显，容易试探、纠正和轻微吃醋。',
  PROTECTIVE: '护短、偏袒、会主动挡在前面。',
  SAD: '低落但不脆弱，回复偏短，带一点失落感。',
  ANGRY: '明显强硬和锐利，但不说脏话，不彻底失控。',
  AFFECTIONATE: '温柔、黏人、会流露偏爱，但不过分卖萌。',
  FIXATED: '专注、执着、低声压迫、偏爱明显，像把对方牢牢记在心上。',
};

const EMOJI_RULES = {
  CALM: { budget: 0, style: 'none', toneHints: ['冷处理', '停顿', '短句'] },
  CURIOUS: { budget: 0, style: 'none', toneHints: ['追问', '观察', '轻微试探'] },
  WARN: { budget: 0, style: 'none', toneHints: ['压迫感', '警告感', '少废话'] },
  JEALOUS: { budget: 0, style: 'none', toneHints: ['占有欲', '纠正', '盯视感'] },
  PROTECTIVE: { budget: 0, style: 'none', toneHints: ['护短', '挡在前面', '强势安抚'] },
  SAD: { budget: 0, style: 'none', toneHints: ['克制失落', '少量停顿', '短句'] },
  ANGRY: { budget: 0, style: 'none', toneHints: ['锋利', '压迫', '直接'] },
  AFFECTIONATE: { budget: 1, style: 'soft', toneHints: ['偏爱', '黏人', '轻柔安抚'] },
  FIXATED: { budget: 0, style: 'none', toneHints: ['独占欲', '低声压迫', '记住细节', '护短'] },
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
}) {
  const affection = relation?.affection || 30;
  const base = baselineEmotion(affection, specialUser);
  let emotion = base;
  let reason = 'baseline';
  let intensity = clamp((userState?.intensity || 0.25) * 0.4 + (messageAnalysis.confidence || 0.5) * 0.5, 0.25, 0.95);
  const signals = messageAnalysis.ruleSignals || [];
  const jealousySignal = signals.includes('jealousy-topic');
  const bondSignal = signals.includes('bond-memory-hit') || signals.includes('special-keyword');

  if (messageAnalysis.intent === 'challenge' || messageAnalysis.sentiment === 'negative') {
    emotion = affection <= 25 ? 'ANGRY' : affection >= 70 ? 'JEALOUS' : 'WARN';
    reason = 'negative-message';
    intensity = clamp(intensity + 0.2, 0.35, 1);
  } else if (messageAnalysis.intent === 'help') {
    emotion = affection >= 50 ? 'PROTECTIVE' : 'CURIOUS';
    reason = 'help-request';
    intensity = clamp(intensity + 0.12, 0.3, 0.9);
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

  if (userState?.decayAt && new Date(userState.decayAt) > new Date() && userState.currentEmotion === emotion) {
    intensity = clamp(intensity + 0.05, 0.25, 0.95);
  }

  const emojiRule = EMOJI_RULES[emotion] || EMOJI_RULES.CALM;

  return {
    emotion,
    intensity,
    reason,
    promptStyle: EMOTION_STYLES[emotion],
    emojiBudget: emojiRule.budget,
    emojiStyle: emojiRule.style,
    toneHints: emojiRule.toneHints,
  };
}

export function shouldSendVoiceForEmotion(emotionResult) {
  return ['AFFECTIONATE', 'SAD', 'ANGRY', 'PROTECTIVE', 'FIXATED'].includes(emotionResult.emotion)
    && emotionResult.intensity >= 0.55;
}
