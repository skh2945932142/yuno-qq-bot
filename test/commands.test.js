import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommandResponse, parseCommand } from '../src/command-parser.js';

test('parseCommand recognizes relation, profile, and report commands', () => {
  assert.deepEqual(parseCommand('/relation'), { type: 'relation', toolName: 'get_relation', toolArgs: {} });
  assert.deepEqual(parseCommand('/profile'), { type: 'profile', toolName: 'get_profile', toolArgs: {} });
  assert.deepEqual(parseCommand('/groupreport 48'), { type: 'group_report', toolName: 'get_group_report', toolArgs: { windowHours: 48 } });
});

test('buildCommandResponse formats profile output', () => {
  const text = buildCommandResponse({ type: 'profile' }, {
    relation: {
      memorySummary: 'prefs: cats / topics: games',
      preferences: ['cats'],
      favoriteTopics: ['games'],
      affection: 65,
      activeScore: 44,
    },
    userState: {
      currentEmotion: 'CURIOUS',
      intensity: 0.55,
      triggerReason: 'positive-message',
    },
    userProfile: {
      profileSummary: 'preferred name: tester',
      favoriteTopics: ['games'],
    },
    groupState: {
      mood: 'CALM',
      activityLevel: 32,
      recentTopics: ['games'],
    },
  });

  assert.equal(text.includes('preferred name: tester'), true);
  assert.equal(text.includes('games'), true);
  assert.equal(text.includes('我替你把画像翻出来了'), true);
});
