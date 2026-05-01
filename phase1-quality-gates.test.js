import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReplyContext } from './src/prompt-builder.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SCAN_TARGETS = ['src', 'evals', 'smoke.js'];
const MOJIBAKE_SNIPPETS = [
  '鈧',
  '閸',
  '娑',
  '榛樿',
  '涓嶈',
  '鍙',
  '绛旂敤',
  '鏂囨湰',
  '鐢ㄦ埛',
  '杩囩▼',
];

async function collectFiles(target) {
  const absolute = path.resolve(ROOT, target);
  const stat = await fs.stat(absolute);
  if (stat.isFile()) {
    return [absolute];
  }

  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const next = path.join(absolute, entry.name);
    if (entry.isDirectory()) return collectFiles(path.relative(ROOT, next));
    if (/\.(js|json|md)$/.test(entry.name)) return [next];
    return [];
  }));
  return nested.flat();
}

test('model-visible source and eval text do not contain mojibake snippets', async () => {
  const files = (await Promise.all(SCAN_TARGETS.map(collectFiles))).flat();
  const offenders = [];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const hits = MOJIBAKE_SNIPPETS.filter((snippet) => text.includes(snippet));
    if (hits.length > 0) {
      offenders.push(`${path.relative(process.cwd(), file)}: ${hits.join(',')}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test('companion prompt snapshot keeps natural preference boundaries', () => {
  const prompt = buildReplyContext({
    event: { platform: 'qq', chatType: 'group', chatId: 'g1', userId: 'u1', userName: 'Alice' },
    route: { category: 'group_chat' },
    relation: { affection: 68, memorySummary: '最近聊天比较自然' },
    userState: { currentEmotion: 'CALM' },
    userProfile: {
      profileSummary: '偏好自然、温柔但不啰嗦的回复',
      favoriteTopics: ['游戏'],
      dislikes: ['说教'],
      speakingStyleSummary: '爱玩梗，常用短句',
      frequentPhrases: ['笑死', 'QAQ'],
      responsePreference: 'balanced',
      emojiStyle: 'expressive-text',
    },
    conversationState: { rollingSummary: '刚聊过今天压力有点大', messages: [] },
    groupState: { mood: 'CALM', activityLevel: 32, recentTopics: ['日常'] },
    recentEvents: [{ summary: '群里刚才在聊游戏' }],
    memoryContext: {
      eventMemories: [{ summary: 'Alice 提到这周有面试' }],
      memeMemories: [{ caption: '压力大时会发的无语表情', usageContext: 'stress-reaction', semanticTags: ['stressed'] }],
    },
    messageAnalysis: { intent: 'chat', sentiment: 'neutral', relevance: 0.85, ruleSignals: ['direct-mention'] },
    emotionResult: { intensity: 0.45, toneHints: ['natural'] },
    knowledge: { documents: [] },
    isAdmin: false,
    replyLengthProfile: {
      performanceProfile: 'standard_chat',
      promptProfile: 'standard',
      guidance: '自然回答，不刷屏',
    },
    replyPlan: {
      type: 'direct_followup',
      depth: 'short',
      questionNeeded: true,
      interpretation: {
        subIntent: '玩梗接话',
        tone: '轻松接梗',
        expectsDepth: 'short',
        needsEmpathy: false,
      },
    },
  });

  assert.match(prompt, /自然偏爱|轻微偏爱|偏爱感/);
  assert.match(prompt, /不要病娇化|控制对方|过度占有/);
  assert.match(prompt, /当前理解/);
  assert.match(prompt, /表情风格记忆/);
  assert.match(prompt, /禁止输出 <think>\/<thinking>/);
});
