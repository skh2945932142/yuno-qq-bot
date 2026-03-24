import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplyContext } from './src/prompt-builder.js';

test('buildReplyContext injects special-user persona and diary memory cues', () => {
  const prompt = buildReplyContext({
    event: { chatType: 'private', userName: 'Scathach' },
    route: { category: 'private_chat', allowFollowUp: true },
    relation: { affection: 95, memorySummary: '特殊对象:Scathach；活跃度:90' },
    userState: { currentEmotion: 'FIXATED' },
    userProfile: {
      profileSummary: '偏好语气:暧昧',
      preferredName: '师父',
      favoriteTopics: ['教导'],
      dislikes: ['冷落'],
      specialBondSummary: '特殊关系对象:Scathach；专属称呼:师父；共同记忆:约定',
      specialNicknames: ['师父'],
      bondMemories: ['约定', '教导'],
    },
    conversationState: { rollingSummary: '上次聊到约定', messages: [{ role: 'user', content: '你记得吗' }] },
    groupState: null,
    recentEvents: [],
    messageAnalysis: { intent: 'chat', sentiment: 'positive', relevance: 0.9, ruleSignals: ['special-user'] },
    emotionResult: { intensity: 0.92, promptStyle: '专注、执着', toneHints: ['独占欲', '记住细节'] },
    knowledge: { documents: [] },
    isAdmin: false,
    specialUser: {
      label: 'Scathach',
      personaMode: 'exclusive_adoration',
      toneMode: 'flirtatious_favorite',
      addressUserAs: '斯卡哈',
      privateStyle: '私聊里更黏人、更暧昧。',
      groupStyle: '群聊里更克制地护短。',
    },
  });

  assert.match(prompt, /特殊用户覆盖/);
  assert.match(prompt, /Scathach/);
  assert.match(prompt, /日记式记忆提醒/);
  assert.match(prompt, /专属关系摘要/);
  assert.match(prompt, /现实威胁|现实伤害边界/);
});
