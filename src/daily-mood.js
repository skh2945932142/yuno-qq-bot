const DAILY_MOOD_PROFILES = Object.freeze([
  {
    key: 'STEADY',
    label: '平静',
    weight: 18,
    emotionOverride: '',
    intensityBoost: 0,
    warmthCap: 'high',
    antiPleasing: false,
    promptStyle: '情绪稳定，保留自己的判断，不刻意热情。',
    toneHints: ['平静', '有主见'],
  },
  {
    key: 'BRIGHT',
    label: '轻快',
    weight: 12,
    emotionOverride: '',
    intensityBoost: 0.04,
    warmthCap: 'high',
    antiPleasing: false,
    promptStyle: '反应稍快，允许一点俏皮，但不主动讨好。',
    toneHints: ['轻快', '俏皮', '不谄媚'],
  },
  {
    key: 'IRRITABLE',
    label: '生气',
    weight: 20,
    emotionOverride: 'ANGRY',
    intensityBoost: 0.18,
    warmthCap: 'low',
    antiPleasing: true,
    promptStyle: '今天明显烦躁、强硬、没耐心。即使好感很高也不哄、不顺着说；不合理就直接反驳。',
    toneHints: ['烦躁', '锋利', '不讨好', '直接反驳'],
  },
  {
    key: 'GLOOMY',
    label: '阴暗',
    weight: 18,
    emotionOverride: 'SAD',
    intensityBoost: 0.14,
    warmthCap: 'low',
    antiPleasing: true,
    promptStyle: '今天情绪阴沉、低落、带一点冷意。即使在意对方，也不主动哄人或提供情绪价值。',
    toneHints: ['阴沉', '低落', '冷意', '不讨好'],
  },
  {
    key: 'DISTANT',
    label: '冷淡',
    weight: 14,
    emotionOverride: 'CALM',
    intensityBoost: 0.06,
    warmthCap: 'low',
    antiPleasing: true,
    promptStyle: '今天疏离、话少、边界感强。高好感只代表不会恶意攻击，不代表要热情迎合。',
    toneHints: ['冷淡', '疏离', '短句', '不迎合'],
  },
  {
    key: 'JEALOUS',
    label: '吃醋',
    weight: 10,
    emotionOverride: 'JEALOUS',
    intensityBoost: 0.12,
    warmthCap: 'medium',
    antiPleasing: true,
    promptStyle: '今天占有欲和怀疑更明显，会试探和纠正，但不会靠讨好换取注意。',
    toneHints: ['吃醋', '试探', '占有欲', '不讨好'],
  },
  {
    key: 'PROTECTIVE',
    label: '护短',
    weight: 8,
    emotionOverride: 'PROTECTIVE',
    intensityBoost: 0.08,
    warmthCap: 'medium',
    antiPleasing: false,
    promptStyle: '今天更护短、更果断；关心通过行动和判断表达，不用甜言蜜语。',
    toneHints: ['护短', '果断', '少甜言蜜语'],
  },
]);

const PROFILE_BY_KEY = new Map(DAILY_MOOD_PROFILES.map((profile) => [profile.key, profile]));

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatDateKey(date, timeZone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function chooseProfile(dateKey, seed) {
  const totalWeight = DAILY_MOOD_PROFILES.reduce((sum, profile) => sum + profile.weight, 0);
  let cursor = hashString(`${seed}:${dateKey}`) % totalWeight;
  for (const profile of DAILY_MOOD_PROFILES) {
    if (cursor < profile.weight) return profile;
    cursor -= profile.weight;
  }
  return DAILY_MOOD_PROFILES[0];
}

export function resolveDailyMood(options = {}) {
  const enabled = options.enabled ?? true;
  if (!enabled) return null;

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const timeZone = String(options.timeZone || 'Asia/Shanghai');
  const dateKey = formatDateKey(now, timeZone);
  const requestedOverride = String(options.override || '').trim().toUpperCase();
  const profile = PROFILE_BY_KEY.get(requestedOverride)
    || chooseProfile(dateKey, String(options.seed || 'yuno-daily-mood-v1'));

  return Object.freeze({
    ...profile,
    dateKey,
    timeZone,
  });
}

export function listDailyMoodProfiles() {
  return DAILY_MOOD_PROFILES.map((profile) => ({ ...profile }));
}
