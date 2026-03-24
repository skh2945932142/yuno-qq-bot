import { config } from './config.js';
import { getSpecialUserByUserId, getSpecialUserKnowledgeTags } from './special-users.js';

export function resolveUserPersonaPolicy({ userId, scene = 'group', relation = null, basePersona = 'yuno' } = {}) {
  const specialUser = getSpecialUserByUserId(userId);
  const isAdmin = String(userId || '') === String(config.adminQq || '');
  const affection = Number(relation?.affection || 0);
  const normalizedScene = String(scene || 'group') === 'private' ? 'private' : 'group';

  return {
    basePersona,
    scene: normalizedScene,
    isAdmin,
    specialUser,
    personaMode: specialUser?.personaMode || (isAdmin ? 'trusted_admin' : 'default'),
    toneMode: specialUser?.toneMode || (isAdmin ? 'steady_respect' : 'default'),
    affectionFloor: Number(specialUser?.affectionFloor || 0),
    knowledgeTags: getSpecialUserKnowledgeTags(specialUser),
    styleRules: {
      addressUserAs: specialUser?.addressUserAs || '',
      addressBotAs: specialUser?.addressBotAs || 'Yuno',
      intimacyLevel: specialUser ? (normalizedScene === 'private' ? 'high' : 'medium') : affection >= 70 ? 'warm' : 'neutral',
      sceneBias: normalizedScene === 'private' ? 'complete' : 'concise',
    },
    triggerOverrides: {
      lowerReplyThreshold: Boolean(specialUser),
      allowPriorityReply: isAdmin || Boolean(specialUser),
    },
    retrievalBoosts: {
      preferredTags: getSpecialUserKnowledgeTags(specialUser),
    },
  };
}
