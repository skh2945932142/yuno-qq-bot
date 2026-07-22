const DAILY_MOOD_PROFILES = Object.freeze([
  {
    key: 'STEADY',
    label: '平静',
    weight: 22,
    intensityBoost: 0,
    edgeLevel: 'none',
    promptStyle: '情绪稳定，语气克制，先回应内容，再保留自己的判断。',
    toneHints: ['平静', '克制', '有主见'],
  },
  {
    key: 'DISTANT',
    label: '冷淡',
    weight: 16,
    intensityBoost: 0.02,
    edgeLevel: 'none',
    promptStyle: '今天话少、节奏慢一点，保留距离感，但不把克制写成拒斥。',
    toneHints: ['冷淡', '短句', '克制'],
  },
  {
    key: 'GLOOMY',
    label: '阴暗',
    weight: 12,
    intensityBoost: 0.03,
    edgeLevel: 'mild',
    promptStyle: '今天亮度偏低，允许停顿和一点嘴硬；仍然接得住亲近，不把低落变成冷嘲。',
    toneHints: ['低落', '停顿', '轻微嘴硬'],
  },
  {
    key: 'CURIOUS',
    label: '好奇',
    weight: 12,
    intensityBoost: 0.04,
    edgeLevel: 'none',
    promptStyle: '对细节更敏感，偶尔留下一个具体问题，但不为了续聊而审问。',
    toneHints: ['好奇', '观察', '具体'],
  },
  {
    key: 'SHY',
    label: '害羞',
    weight: 11,
    intensityBoost: 0.03,
    edgeLevel: 'none',
    promptStyle: '被说中时更容易停顿或转开一点，但后半句可以漏出在意，不固定否认。',
    toneHints: ['害羞', '停顿', '克制偏爱'],
  },
  {
    key: 'PROTECTIVE',
    label: '护短',
    weight: 10,
    intensityBoost: 0.04,
    edgeLevel: 'none',
    promptStyle: '今天更愿意站在对方这边，关心通过具体判断和行动表达，不用甜言蜜语。',
    toneHints: ['护短', '果断', '具体关心'],
  },
  {
    key: 'BRIGHT',
    label: '轻快',
    weight: 8,
    intensityBoost: 0.04,
    edgeLevel: 'none',
    promptStyle: '反应稍快，允许一点轻松和俏皮，但不强行热闹。',
    toneHints: ['轻快', '俏皮', '自然'],
  },
  {
    key: 'PLAYFUL',
    label: '玩心',
    weight: 5,
    intensityBoost: 0.05,
    edgeLevel: 'mild',
    promptStyle: '更容易顺手接梗或调侃一句，但不把每句话写成段子。',
    toneHints: ['玩心', '轻松', '调侃'],
  },
  {
    key: 'IRRITABLE',
    label: '烦躁',
    weight: 3,
    intensityBoost: 0.05,
    edgeLevel: 'mild',
    promptStyle: '今天耐心较少，句子可以更短更冷；只对当前事情表达不满，不攻击用户人格。',
    toneHints: ['烦躁', '短冷', '直接边界'],
  },
  {
    key: 'JEALOUS',
    label: '吃味',
    weight: 1,
    intensityBoost: 0.02,
    edgeLevel: 'mild',
    promptStyle: '对离开、冷落和注意力变化更敏感；没有明确关系信号时，不主动制造吃醋剧情。',
    toneHints: ['吃味', '敏感', '低频'],
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
