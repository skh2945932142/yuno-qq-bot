import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from './src/config.js';
import { MemeAsset, UserMemoryEvent, UserProfileMemory } from './src/models.js';
import { mapCommandToTool, registerQueryTools } from './src/query-tools.js';

test('query tools register all definitions and map known/unknown commands', async () => {
  const definitions = [];
  const registry = { register: (definition) => definitions.push(definition) };
  assert.equal(registerQueryTools(registry), registry);
  assert.ok(definitions.length >= 20);
  assert.equal(mapCommandToTool(null), null);
  assert.equal(mapCommandToTool({ toolName: 'missing' }), null);
  const mapped = mapCommandToTool({ toolName: 'get_help', toolArgs: { verbose: true } });
  assert.equal(mapped.name, 'get_help');
  assert.deepEqual(mapped.args, { verbose: true });
});

function context(chatType = 'private', overrides = {}) {
  return {
    event: { platform: 'qq', chatType, chatId: 'group-1', userId: 'user-1' },
    relation: {
      affection: 70, activeScore: 12, currentEmotion: 'CALM', memorySummary: 'summary',
      preferences: ['tea'], favoriteTopics: ['music'],
    },
    userState: { currentEmotion: 'CURIOUS', intensity: 0.6, triggerReason: 'question' },
    userProfile: {
      profileSummary: 'likes direct answers', preferredName: 'Alice', tonePreference: 'calm',
      responsePreference: 'short', emojiStyle: 'none', humorStyle: 'dry', speakingStyleSummary: 'direct',
      favoriteTopics: ['music'], dislikes: [], profileKey: 'qq:user-1', memeOptOut: false,
    },
    groupState: { mood: 'CALM', activityLevel: 60, recentTopics: ['music'] },
    memoryContext: {
      eventMemories: [{ memoryId: 'm1', eventType: 'preference', summary: 'prefers direct answers' }],
    },
    analysis: { shouldRespond: true, reason: 'direct-mention', confidence: 0.9, relevance: 0.8, ruleSignals: ['mention'] },
    ...overrides,
  };
}

async function execute(definitions, name, args, ctx) {
  const definition = definitions.find((item) => item.name === name);
  assert.ok(definition, `missing tool ${name}`);
  return definition.execute(args, ctx);
}

test('query tools produce private and group-safe structured results', async () => {
  const definitions = [];
  registerQueryTools({ register: (definition) => definitions.push(definition) });
  const privateContext = context();

  assert.equal((await execute(definitions, 'get_relation', {}, privateContext)).tool, 'get_relation');
  assert.equal((await execute(definitions, 'get_emotion', {}, privateContext)).tool, 'get_emotion');
  assert.equal((await execute(definitions, 'get_profile', {}, privateContext)).tool, 'get_profile');
  assert.equal((await execute(definitions, 'get_memory', {}, privateContext)).tool, 'get_memory');
  assert.equal((await execute(definitions, 'get_style', {}, privateContext)).tool, 'get_style');
  assert.equal((await execute(definitions, 'get_help', {}, privateContext)).tool, 'get_help');

  const groupContext = context('group');
  assert.equal((await execute(definitions, 'get_group_state', {}, groupContext)).tool, 'get_group_state');
  for (const name of ['get_profile', 'get_memory', 'get_style', 'forget_user_memory']) {
    const result = await execute(definitions, name, {}, groupContext);
    assert.equal(result.payload.privateOnly, true);
  }
});

test('query tools cover memory/style validation and admin-only debug access', async () => {
  const definitions = [];
  registerQueryTools({ register: (definition) => definitions.push(definition) });
  const privateContext = context();

  const emptyForget = await execute(definitions, 'forget_user_memory', {}, privateContext);
  assert.equal(emptyForget.payload.deletedCount, 0);
  const invalidStyle = await execute(definitions, 'update_style', { key: 'tone', value: '' }, privateContext);
  assert.equal(invalidStyle.payload.updated, false);

  await assert.rejects(() => execute(definitions, 'debug_why', {}, privateContext), /管理员权限/);
  const adminContext = context('private', { event: { ...privateContext.event, userId: config.adminQq || 'admin' } });
  const debug = await execute(definitions, 'debug_why', {}, adminContext);
  assert.equal(debug.tool, 'debug_why');
  assert.equal(debug.payload.shouldRespond, true);
});

test('query tools cover persistent style, memory, meme, and opt-out mutations with model fakes', async () => {
  const definitions = [];
  registerQueryTools({ register: (definition) => definitions.push(definition) });
  const privateContext = context();
  const originalProfileUpdate = UserProfileMemory.findOneAndUpdate;
  const originalMemoryDelete = UserMemoryEvent.deleteMany;
  const originalMemeFind = MemeAsset.find;
  const calls = [];
  try {
    UserProfileMemory.findOneAndUpdate = async (...args) => {
      calls.push(['profile', ...args]);
      return { profileSummary: 'updated profile' };
    };
    UserMemoryEvent.deleteMany = async (...args) => {
      calls.push(['memory', ...args]);
      return { deletedCount: 2 };
    };
    MemeAsset.find = () => ({
      limit() { return this; },
      sort() { return Promise.resolve([{ assetId: 'asset-1', caption: 'deploy', tags: ['deploy'] }]); },
    });

    const style = await execute(definitions, 'update_style', { key: 'tone', value: 'direct' }, privateContext);
    assert.equal(style.payload.updated, true);
    assert.equal(style.payload.patch.tonePreference, 'direct');
    const fallbackStyle = await execute(definitions, 'update_style', { key: 'custom', value: 'brief' }, privateContext);
    assert.equal(fallbackStyle.payload.patch.speakingStyleSummary, 'brief');
    const forgotten = await execute(definitions, 'forget_user_memory', { query: 'deploy' }, privateContext);
    assert.equal(forgotten.payload.deletedCount, 2);
    const search = await execute(definitions, 'search_memes', { query: 'deploy' }, privateContext);
    assert.equal(search.payload.count, 1);
    const optOut = await execute(definitions, 'set_meme_opt_out', { optOut: true }, privateContext);
    assert.equal(optOut.payload.optOut, true);
    assert.equal(calls.length >= 3, true);
  } finally {
    UserProfileMemory.findOneAndUpdate = originalProfileUpdate;
    UserMemoryEvent.deleteMany = originalMemoryDelete;
    MemeAsset.find = originalMemeFind;
  }
});
