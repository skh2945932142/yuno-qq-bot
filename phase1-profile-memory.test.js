import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileSummary, extractStableProfileUpdate } from './src/profile-memory.js';

test('extractStableProfileUpdate captures stable user preferences', () => {
  const result = extractStableProfileUpdate('你可以叫我阿明，我喜欢聊游戏，对我温柔一点。', {
    confidence: 0.9,
  });

  assert.equal(result.shouldPersist, true);
  assert.equal(result.update.preferredName, '阿明');
  assert.match(result.update.favoriteTopics.join(','), /游戏/);
  assert.equal(result.update.relationshipPreference, '希望被温柔对待');
});

test('buildProfileSummary renders long-term memory fields', () => {
  const summary = buildProfileSummary({
    preferredName: '阿明',
    tonePreference: '温柔',
    favoriteTopics: ['游戏'],
    dislikes: ['剧透'],
    relationshipPreference: '希望被温柔对待',
    roleplaySettings: ['把你当青梅竹马'],
  });

  assert.match(summary, /阿明/);
  assert.match(summary, /剧透/);
  assert.match(summary, /青梅竹马/);
});
