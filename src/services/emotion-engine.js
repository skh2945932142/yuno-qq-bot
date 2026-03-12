import { clamp } from '../utils.js';

const EMOTION_STYLES = {
  CALM: '冷静、审视、简洁，像在判断局势。',
  CURIOUS: '对细节感兴趣，会追问，但不喋喋不休。',
  WARN: '保持警惕，带一点压迫感和试探。',
  JEALOUS: '占有欲明显，语气发紧，但不失控。',
  PROTECTIVE: '护短、守群、对熟人偏袒。',
  SAD: '情绪低落但不示弱，回答偏短。',
  ANGRY: '明显强硬和攻击性，但不使用脏话或彻底失控。',
  AFFECTIONATE: '偏温柔黏人，会流露偏爱和在意。',
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

  return {
    emotion,
    intensity,
    reason,
    promptStyle: EMOTION_STYLES[emotion],
  };
}

export function shouldSendVoiceForEmotion(emotionResult) {
  return ['AFFECTIONATE', 'SAD', 'ANGRY', 'PROTECTIVE'].includes(emotionResult.emotion)
    && emotionResult.intensity >= 0.55;
}
