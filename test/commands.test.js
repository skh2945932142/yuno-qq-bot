import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommandResponse, parseCommand } from '../src/services/commands.js';

test('parseCommand recognizes relation query', () => {
  assert.deepEqual(parseCommand('/关系'), { type: 'relation' });
  assert.deepEqual(parseCommand('/profile'), { type: 'profile' });
  assert.deepEqual(parseCommand('由乃 群状态'), { type: 'group' });
});

test('buildCommandResponse formats profile output', () => {
  const text = buildCommandResponse({ type: 'profile' }, {
    relation: {
      memorySummary: '偏好:猫；常聊:游戏',
      preferences: ['猫'],
      favoriteTopics: ['游戏'],
      affection: 65,
      activeScore: 44,
    },
    userState: {
      currentEmotion: 'CURIOUS',
      intensity: 0.55,
      triggerReason: 'positive-message',
    },
    groupState: {
      mood: 'CALM',
      activityLevel: 32,
      recentTopics: ['游戏'],
    },
  });

  assert.match(text, /画像摘要/);
  assert.match(text, /偏好/);
});
