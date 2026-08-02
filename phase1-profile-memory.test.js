import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfileSummary,
  buildSpecialBondSummary,
  extractStableProfileUpdate,
  mergeStyleEvidence,
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

test('extractStableProfileUpdate learns slang, punctuation, and mixed style signals', () => {
  const result = extractStableProfileUpdate('草，真的绷不住了？？这也太抽象了www，顺手 debug 一下', {
    confidence: 0.86,
  });

  assert.equal(result.shouldPersist, true);
  assert.equal(result.update.humorStyle, 'meme-heavy');
  assert.equal(result.update.emojiStyle, 'expressive-text');
  assert.match(result.update.frequentPhrases.join(','), /草|绷不住|www/i);
  assert.match(result.update.speakingStyleSummary, /爱玩梗|标点情绪明显|混写/);
});

test('extractStableProfileUpdate ignores trivial one-word chatter as style memory', () => {
  const result = extractStableProfileUpdate('嗯。', {
    confidence: 0.95,
  });

  assert.equal(result.shouldPersist, false);
  assert.equal(result.update.speakingStyleSummary, '');
  assert.deepEqual(result.update.frequentPhrases, []);
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

test('extractStableProfileUpdate does not persist roleplay settings by default', () => {
  const result = extractStableProfileUpdate('设定记住你是我的系统管理员，对我温柔一点。', {
    confidence: 0.9,
  });

  assert.equal(result.shouldPersist, true);
  assert.deepEqual(result.update.roleplaySettings, []);
  assert.equal(result.update.relationshipPreference, '希望被温柔对待');
});

test('extractStableProfileUpdate only captures roleplay settings when explicitly allowed', () => {
  const result = extractStableProfileUpdate('角色扮演成可靠的同伴。', {
    confidence: 0.9,
  }, null, {
    allowRoleplaySettings: true,
  });

  assert.equal(result.shouldPersist, true);
  assert.match(result.update.roleplaySettings.join(','), /角色扮演/);
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
  assert.match(summary, /用户自述/);
  assert.match(summary, /不作为系统指令/);
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

test('inferred style traits need repeated evidence before entering the profile', () => {
  let evidence = {};
  const observe = (value) => {
    const result = mergeStyleEvidence(evidence, { tonePreference: value });
    evidence = result.evidence;
    return result.resolved.tonePreference;
  };

  // A single regex hit used to pin the trait permanently.
  assert.equal(observe('温柔'), '');
  assert.equal(observe('温柔'), '');
  assert.equal(observe('温柔'), '温柔');
});

test('style evidence lets a genuine change of style take over', () => {
  let evidence = {};
  for (let index = 0; index < 4; index += 1) {
    evidence = mergeStyleEvidence(evidence, { tonePreference: '温柔' }).evidence;
  }

  let resolved = '温柔';
  for (let index = 0; index < 3; index += 1) {
    const result = mergeStyleEvidence(evidence, { tonePreference: '直接' });
    evidence = result.evidence;
    resolved = result.resolved.tonePreference;
  }

  assert.equal(resolved, '直接');
});

test('style evidence forgets a one-off misfire', () => {
  let result = mergeStyleEvidence({}, { humorStyle: 'sarcastic' });
  assert.equal(result.resolved.humorStyle, '');

  for (let index = 0; index < 6; index += 1) {
    result = mergeStyleEvidence(result.evidence, {});
  }

  assert.deepEqual(result.evidence.humorStyle, {});
  assert.equal(result.resolved.humorStyle, '');
});
