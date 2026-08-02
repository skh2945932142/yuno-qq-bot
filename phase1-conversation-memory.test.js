import test from 'node:test';
import assert from 'node:assert/strict';
import { appendConversationMessages, compactConversationState } from './src/conversation-memory.js';

test('compactConversationState rolls older messages into a summary after eight messages', () => {
  const state = compactConversationState({
    rollingSummary: '',
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a3' },
      { role: 'user', content: 'u4' },
      { role: 'assistant', content: 'a4' },
      { role: 'user', content: 'u5' },
      { role: 'assistant', content: 'a5' },
    ],
  });

  assert.equal(state.messages.length, 8);
  assert.match(state.rollingSummary, /u1/);
  assert.match(state.rollingSummary, /a1/);
  assert.equal(state.summarizedCount, 2);
});

test('compactConversationState preserves assistant style metadata for repetition guards', () => {
  const compacted = compactConversationState({
    rollingSummary: '',
    messages: [
      { role: 'user', content: '靠一下' },
      { role: 'assistant', content: '这次让你靠一会儿。', styleMove: 'mild_edge', edgeScore: 1 },
    ],
  });

  assert.equal(compacted.messages[1].styleMove, 'mild_edge');
  assert.equal(compacted.messages[1].edgeScore, 1);
});

test('compactConversationState drops whole summary entries instead of slicing characters', () => {
  const messages = Array.from({ length: 120 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `M${index}-${'内容'.repeat(20)}`,
  }));

  const state = compactConversationState({ rollingSummary: '', messages });
  const entries = state.rollingSummary.split(' | ');

  assert.ok(state.rollingSummary.length <= 1200);
  assert.ok(entries.length > 1);
  // The old implementation kept the tail with slice(length - limit), which left a
  // partial message (and sometimes a partial character) at the front.
  for (const entry of entries) {
    assert.match(entry, /^(User|Bot): /, `summary entry lost its structure: ${entry}`);
  }
  assert.equal(state.rollingSummary.includes('M0-'), false, 'oldest entry should be dropped');
  assert.equal(state.rollingSummary.includes('M111-'), true, 'newest summarized entry should survive');
});

test('compactConversationState migrates the legacy double-pipe summary format', () => {
  const state = compactConversationState({
    rollingSummary: 'User: 老消息一 | Bot: 老回复一 || User: 老消息二',
    messages: Array.from({ length: 10 }, (_, index) => ({ role: 'user', content: `新${index}` })),
  });

  assert.equal(state.rollingSummary.includes('||'), false);
  assert.equal(
    state.rollingSummary,
    'User: 老消息一 | Bot: 老回复一 | User: 老消息二 | User: 新0 | User: 新1'
  );
});

test('compactConversationState escapes pipes inside message content', () => {
  const state = compactConversationState({
    rollingSummary: '',
    messages: [
      { role: 'user', content: 'a|b||c' },
      ...Array.from({ length: 9 }, (_, index) => ({ role: 'user', content: `x${index}` })),
    ],
  });

  const entries = state.rollingSummary.split(' | ');
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.match(entry, /^(User|Bot): /);
  }
});

test('appendConversationMessages retries optimistic conflicts without losing intervening turns', async () => {
  const session = {
    platform: 'qq', chatType: 'private', chatId: 'user-1', userId: 'user-1',
  };
  const storedStates = [
    {
      sessionKey: 'qq:private:user-1:user-1', revision: 0, rollingSummary: '',
      messages: [{ role: 'user', content: 'base' }],
    },
    {
      sessionKey: 'qq:private:user-1:user-1', revision: 1, rollingSummary: '',
      messages: [
        { role: 'user', content: 'base' },
        { role: 'assistant', content: 'intervening' },
      ],
    },
  ];
  let reads = 0;
  let updates = 0;
  const model = {
    async findOne() {
      const state = storedStates[Math.min(reads, storedStates.length - 1)];
      reads += 1;
      return {
        ...state,
        toObject: () => ({ ...state }),
      };
    },
    async findOneAndUpdate(_filter, update) {
      updates += 1;
      if (updates === 1) {
        const conflict = new Error('duplicate key');
        conflict.code = 11000;
        throw conflict;
      }
      const state = {
        ...update.$set,
        revision: 2,
      };
      return {
        ...state,
        toObject: () => ({ ...state }),
      };
    },
  };

  const result = await appendConversationMessages(session, [
    { role: 'user', content: 'new turn' },
  ], { ConversationState: model, maxAttempts: 2 });

  assert.equal(updates, 2);
  assert.equal(result.revision, 2);
  assert.deepEqual(
    result.messages.map((item) => item.content),
    ['base', 'intervening', 'new turn']
  );
});
