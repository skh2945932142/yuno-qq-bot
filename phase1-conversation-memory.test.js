import test from 'node:test';
import assert from 'node:assert/strict';
import { compactConversationState } from './src/conversation-memory.js';

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
