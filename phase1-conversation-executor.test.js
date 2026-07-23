import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConversationExecutionKey, createConversationExecutor } from './src/conversation-executor.js';

function event(chatId, userId = 'user-1') {
  return { platform: 'qq', chatType: 'group', chatId, userId };
}

test('conversation executor serializes work for the same session', async () => {
  const executor = createConversationExecutor();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = executor.run(event('group-1'), async () => {
    order.push('first:start');
    await firstGate;
    order.push('first:end');
  });
  const second = executor.run(event('group-1'), async () => {
    order.push('second:start');
    order.push('second:end');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);
  assert.equal(executor.size(), 0);
});

test('conversation executor allows unrelated sessions to run concurrently', async () => {
  const executor = createConversationExecutor();
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  const first = executor.run(event('group-1'), async () => {
    started.push('group-1');
    await gate;
  });
  const second = executor.run(event('group-2'), async () => {
    started.push('group-2');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ['group-1', 'group-2']);
  release();
  await Promise.all([first, second]);
});

test('buildConversationExecutionKey matches the persisted session scope', () => {
  assert.equal(
    buildConversationExecutionKey(event('group-1', 'user-2')),
    'qq:group:group-1:user-2'
  );
});
