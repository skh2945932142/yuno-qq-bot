import { clamp } from '../utils.js';

const EMOTION_STYLES = {
  CALM: '冷静、克制、简短，像在观察局势。',
  CURIOUS: '会追问细节，但不黏不闹。',
  WARN: '带警惕和压迫感，语气收紧，不给人轻松感。',
  JEALOUS: '占有欲明显，语气发紧，容易试探和纠正。',
  PROTECTIVE: '护短、偏袒、会主动挡在前面。',
  SAD: '低落但不脆弱，回答偏短，带一点失落感。',
  ANGRY: '明显强硬和攻击性，但不说脏话，不彻底失控。',
  AFFECTIONATE: '温柔、黏人、会流露偏爱，但不过分卖萌。',
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
};

function baselineEmotion(affection) {
  if (affection >= 85) return 'AFFECTIONATE';
  if (affection >= 65) return 'PROTECTIVE';
  if (affection >= 45) return 'CURIOUS';
  if (affection >= 25) return 'CALM';
  return 'WARN';
}

export function resolveEmotion({ relation, userState, groupState, messageAnalysis, isAdmin = false }) {
  const affection = relation?.affection || 30;
  const base = baselineEmotion(affection);
  let emotion = base;
  let reason = 'baseline';
  let intensity = clamp((userState?.intensity || 0.25) * 0.4 + (messageAnalysis.confidence || 0.5) * 0.5, 0.25, 0.95);

  if (messageAnalysis.intent === 'challenge' || messageAnalysis.sentiment === 'negative') {
    emotion = affection <= 25 ? 'ANGRY' : affection >= 70 ? 'JEALOUS' : 'WARN';
    reason = 'negative-message';
    intensity = clamp(intensity + 0.2, 0.35, 1);
  } else if (messageAnalysis.intent === 'help') {
    emotion = affection >= 50 ? 'PROTECTIVE' : 'CURIOUS';
    reason = 'help-request';
    intensity = clamp(intensity + 0.12, 0.3, 0.85);
  } else if (messageAnalysis.sentiment === 'positive') {
    emotion = affection >= 55 ? 'AFFECTIONATE' : 'CURIOUS';
    reason = 'positive-message';
    intensity = clamp(intensity + 0.08, 0.3, 0.8);
  } else if ((groupState?.mood === 'WARN' || groupState?.mood === 'ANGRY') && affection < 60) {
    emotion = 'WARN';
    reason = 'group-tension';
    intensity = clamp(intensity + 0.1, 0.3, 0.9);
  } else if ((groupState?.activityLevel || 0) < 25 && affection >= 60) {
    emotion = 'AFFECTIONATE';
    reason = 'quiet-group';
    intensity = clamp(intensity + 0.05, 0.3, 0.75);
  }

  if (isAdmin && messageAnalysis.sentiment !== 'negative') {
    emotion = emotion === 'WARN' ? 'PROTECTIVE' : emotion;
    intensity = clamp(intensity + 0.05, 0.3, 0.9);
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
  return ['AFFECTIONATE', 'SAD', 'ANGRY', 'PROTECTIVE'].includes(emotionResult.emotion)
    && emotionResult.intensity >= 0.55;
}
