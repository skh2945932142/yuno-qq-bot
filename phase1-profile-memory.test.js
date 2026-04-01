import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfileSummary,
  buildSpecialBondSummary,
  extractStableProfileUpdate,
} from './src/profile-memory.js';

test('extractStableProfileUpdate captures stable user preferences', () => {
  const result = extractStableProfileUpdate('你可以叫我阿明，我喜欢聊游戏，对我温柔一点。', {
    confidence: 0.9,
  });

  assert.equal(result.shouldPersist, true);
  assert.equal(result.update.preferredName, '阿明');
  assert.match(result.update.favoriteTopics.join(','), /游戏/);
  assert.equal(result.update.relationshipPreference, '希望被温柔对待');
});

test('extractStableProfileUpdate captures bond memories for special users', () => {
  const result = extractStableProfileUpdate('记住我们的约定，下次继续教导我。你可以叫我师父。', {
    confidence: 0.9,
  }, {
    label: 'Scathach',
    personaMode: 'exclusive_adoration',
  });

  assert.equal(result.shouldPersist, true);
  assert.match(result.update.bondMemories.join(','), /约定|教导/);
  assert.match(result.update.specialNicknames.join(','), /师父/);
  assert.equal(result.update.personaMode, 'exclusive_adoration');
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

test('buildSpecialBondSummary renders special relationship memory', () => {
  const summary = buildSpecialBondSummary({
    personaMode: 'exclusive_adoration',
    specialNicknames: ['师父'],
    bondMemories: ['教导', '约定'],
  }, {
    label: 'Scathach',
  });

  assert.match(summary, /Scathach/);
  assert.match(summary, /师父/);
  assert.match(summary, /约定/);
});
