import { UserProfileMemory } from './models.js';
import { buildUserProfileKey } from './chat/session.js';
import { uniqueCompact } from './utils.js';
import { getSpecialUserByUserId } from './special-users.js';

function truncateText(text, limit = 80) {
  const normalized = String(text || '').trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

export function buildProfileSummary(profile) {
  const segments = [];

  if (profile.preferredName) {
    segments.push(`偏好称呼:${profile.preferredName}`);
  }

  if (profile.tonePreference) {
    segments.push(`偏好语气:${profile.tonePreference}`);
  }

  if (profile.favoriteTopics?.length) {
    segments.push(`常聊话题:${profile.favoriteTopics.join(' / ')}`);
  }

  if (profile.dislikes?.length) {
    segments.push(`明确不喜欢:${profile.dislikes.join(' / ')}`);
  }

  if (profile.relationshipPreference) {
    segments.push(`关系偏好:${profile.relationshipPreference}`);
  }

  if (profile.roleplaySettings?.length) {
    segments.push(`角色设定:${profile.roleplaySettings.join(' / ')}`);
  }

  return segments.join('；');
}

export function buildSpecialBondSummary(profile, specialUser = null) {
  const segments = [];

  if (specialUser?.label) {
    segments.push(`特殊关系对象:${specialUser.label}`);
  }

  if (profile.personaMode) {
    segments.push(`关系模式:${profile.personaMode}`);
  }

  if (profile.specialNicknames?.length) {
    segments.push(`专属称呼:${profile.specialNicknames.join(' / ')}`);
  }

  if (profile.bondMemories?.length) {
    segments.push(`共同记忆:${profile.bondMemories.slice(0, 3).join(' / ')}`);
  }

  return segments.join('；');
}

function detectTonePreference(text) {
  const normalized = String(text || '');
  const rules = [
    { pattern: /(?:语气|说话|回复).{0,8}(温柔|温和)/i, value: '温柔' },
    { pattern: /(?:语气|说话|回复).{0,8}(直接|直白|少点废话)/i, value: '直接' },
    { pattern: /(?:语气|说话|回复).{0,8}(活泼|可爱)/i, value: '活泼' },
    { pattern: /(?:语气|说话|回复).{0,8}(认真|正式)/i, value: '认真' },
    { pattern: /(?:语气|说话|回复).{0,8}(暧昧|亲近)/i, value: '暧昧' },
  ];

  return rules.find((item) => item.pattern.test(normalized))?.value || '';
}

function extractPreferredName(text) {
  const patterns = [
    /(?:叫我|你可以叫我|称呼我为?)['"“”]?([\u4e00-\u9fa5A-Za-z0-9_-]{1,16})['"“”]?/i,
    /call me ([A-Za-z0-9_-]{1,16})/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) {
      return String(match[1]).trim();
    }
  }

  return '';
}

function extractDislikes(text) {
  const matches = [];
  const patterns = [
    /(?:我不喜欢|我讨厌)([\u4e00-\u9fa5A-Za-z0-9_-]{1,16})/g,
    /(?:别再|不要再)([\u4e00-\u9fa5A-Za-z0-9_-]{1,16})/g,
  ];

  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      if (match?.[1]) {
        matches.push(String(match[1]).trim());
      }
    }
  }

  return uniqueCompact(matches, 5);
}

function extractFavoriteTopics(text) {
  const explicitMatches = [];
  const patterns = [
    /(?:我喜欢聊|我想聊|平时常聊)([\u4e00-\u9fa5A-Za-z0-9_-]{1,16})/g,
    /(?:最近在玩|最近在看)([\u4e00-\u9fa5A-Za-z0-9_-]{1,16})/g,
  ];

  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      if (match?.[1]) {
        explicitMatches.push(String(match[1]).trim());
      }
    }
  }

  return uniqueCompact(explicitMatches, 6);
}

function extractRoleplaySettings(text) {
  const matches = [];
  const patterns = [
    /(设定(?:是我|成我|记住你是|你现在是)([^。！？\n]{1,48}))/g,
    /(角色扮演[^。！？\n]{0,48})/g,
  ];

  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      const content = match?.[2] || match?.[1] || '';
      if (content) {
        matches.push(truncateText(content, 48));
      }
    }
  }

  return uniqueCompact(matches, 4);
}

function extractRelationshipPreference(text) {
  const normalized = String(text || '');
  const rules = [
    { pattern: /(像朋友一样|朋友一点)/i, value: '像朋友一样' },
    { pattern: /(像恋人一样|更亲密一点)/i, value: '更亲密' },
    { pattern: /(对我温柔一点)/i, value: '希望被温柔对待' },
    { pattern: /(对我凶一点)/i, value: '接受更强势一点的互动' },
    { pattern: /(把我当徒弟|把我当学生)/i, value: '偏好师徒关系' },
  ];

  return rules.find((item) => item.pattern.test(normalized))?.value || '';
}

function extractBondMemories(text) {
  const normalized = String(text || '');
  const matches = [];
  const patterns = [
    /(?:记住|别忘了)([^。！？\n]{2,36})/g,
    /(?:我们的约定是|我们约好)([^。！？\n]{2,36})/g,
    /(?:上次说过|之前提过)([^。！？\n]{2,36})/g,
    /(?:一起|共同)([^。！？\n]{2,24})/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const content = match?.[1] || '';
      if (content) {
        matches.push(truncateText(content, 48));
      }
    }
  }

  return uniqueCompact(matches, 6);
}

function extractSpecialNicknames(text) {
  const normalized = String(text || '');
  const matches = [];
  const patterns = [
    /(?:叫我|称呼我为?)['"“”]?([\u4e00-\u9fa5A-Za-z0-9_-]{1,16})['"“”]?/g,
    /(?:你可以喊我|你就叫我)['"“”]?([\u4e00-\u9fa5A-Za-z0-9_-]{1,16})['"“”]?/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      if (match?.[1]) {
        matches.push(String(match[1]).trim());
      }
    }
  }

  return uniqueCompact(matches, 5);
}

export function extractStableProfileUpdate(text, analysis = {}, specialUser = null) {
  const update = {
    preferredName: extractPreferredName(text),
    tonePreference: detectTonePreference(text),
    favoriteTopics: extractFavoriteTopics(text),
    dislikes: extractDislikes(text),
    roleplaySettings: extractRoleplaySettings(text),
    relationshipPreference: extractRelationshipPreference(text),
    bondMemories: specialUser ? extractBondMemories(text) : [],
    specialNicknames: specialUser ? extractSpecialNicknames(text) : [],
    personaMode: specialUser?.personaMode || '',
  };

  const hasMeaningfulData = Boolean(
    update.preferredName
    || update.tonePreference
    || update.favoriteTopics.length > 0
    || update.dislikes.length > 0
    || update.roleplaySettings.length > 0
    || update.relationshipPreference
    || update.bondMemories.length > 0
    || update.specialNicknames.length > 0
    || update.personaMode
  );

  const explicit = Boolean(
    update.preferredName
    || update.tonePreference
    || update.dislikes.length > 0
    || update.roleplaySettings.length > 0
    || update.relationshipPreference
    || update.bondMemories.length > 0
    || update.specialNicknames.length > 0
  );

  return {
    shouldPersist: hasMeaningfulData && (explicit || Number(analysis.confidence || 0) >= 0.75),
    update,
  };
}

export async function ensureUserProfileMemory({ platform = 'qq', userId, userName = '', specialUser = null }) {
  const profileKey = buildUserProfileKey({ platform, userId });
  const resolvedSpecialUser = specialUser || getSpecialUserByUserId(userId);

  return UserProfileMemory.findOneAndUpdate(
    { profileKey },
    {
      $setOnInsert: {
        platform,
        userId: String(userId),
        profileKey,
        displayName: String(userName || ''),
        personaMode: resolvedSpecialUser?.personaMode || '',
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
}

export async function updateUserProfileMemory(profile, { text, analysis, userName, userId, specialUser = null }) {
  const resolvedSpecialUser = specialUser || getSpecialUserByUserId(userId || profile.userId);
  const extracted = extractStableProfileUpdate(text, analysis, resolvedSpecialUser);
  if (!extracted.shouldPersist && !resolvedSpecialUser) {
    return profile;
  }

  const nextProfile = {
    preferredName: extracted.update.preferredName || profile.preferredName || '',
    tonePreference: extracted.update.tonePreference || profile.tonePreference || '',
    favoriteTopics: uniqueCompact([
      ...extracted.update.favoriteTopics,
      ...(profile.favoriteTopics || []),
    ], 6),
    dislikes: uniqueCompact([
      ...extracted.update.dislikes,
      ...(profile.dislikes || []),
    ], 6),
    roleplaySettings: uniqueCompact([
      ...extracted.update.roleplaySettings,
      ...(profile.roleplaySettings || []),
    ], 4),
    relationshipPreference: extracted.update.relationshipPreference || profile.relationshipPreference || '',
    personaMode: extracted.update.personaMode || profile.personaMode || resolvedSpecialUser?.personaMode || '',
    bondMemories: uniqueCompact([
      ...(resolvedSpecialUser?.memorySeeds || []),
      ...extracted.update.bondMemories,
      ...(profile.bondMemories || []),
    ], 8),
    specialNicknames: uniqueCompact([
      ...extracted.update.specialNicknames,
      ...(profile.specialNicknames || []),
      ...(resolvedSpecialUser?.addressUserAs ? [resolvedSpecialUser.addressUserAs] : []),
    ], 6),
  };

  const specialBondSummary = resolvedSpecialUser
    ? buildSpecialBondSummary(nextProfile, resolvedSpecialUser)
    : profile.specialBondSummary || '';

  const updated = await UserProfileMemory.findOneAndUpdate(
    { _id: profile._id },
    {
      $set: {
        displayName: String(userName || profile.displayName || ''),
        ...nextProfile,
        profileSummary: buildProfileSummary(nextProfile),
        specialBondSummary,
        lastUpdated: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (updated) {
    Object.assign(profile, updated.toObject());
  }

  return updated || profile;
}
