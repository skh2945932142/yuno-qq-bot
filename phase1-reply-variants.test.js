import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VARIANT_POOLS,
  buildBudgetFallbackVariant,
  buildDeescalatedVariant,
  buildModelFallbackVariant,
  buildToolAcknowledgementVariant,
  pickReplyVariant,
  resetReplyVariantMemory,
} from './src/reply-variants.js';
import { inspectReplyNaturalness } from './src/reply-naturalness.js';

test('every variant pool has at least four usable entries', () => {
  const names = Object.keys(VARIANT_POOLS);
  assert.ok(names.length >= 12, `pool count ${names.length}`);
  for (const name of names) {
    const pool = VARIANT_POOLS[name];
    assert.ok(pool.length >= 4, `${name} has ${pool.length} entries`);
    const texts = pool.map((entry) => entry.text);
    assert.equal(new Set(texts).size, texts.length, `${name} has duplicates`);
    for (const entry of pool) {
      assert.ok(entry.text.trim().length > 0);
      assert.ok(Number(entry.weight) > 0, `${name} weight`);
    }
  }
});

test('pool copy always passes the reply naturalness gate', () => {
  for (const [name, pool] of Object.entries(VARIANT_POOLS)) {
    for (const entry of pool) {
      for (const chatType of ['private', 'group']) {
        const inspection = inspectReplyNaturalness(entry.text, {
          event: { chatType },
          route: { category: chatType === 'private' ? 'private_chat' : 'group_chat' },
          messageAnalysis: { intent: 'chat', sentiment: 'neutral' },
        });
        assert.deepEqual(inspection.flags, [], `${name}/${chatType}: ${entry.text}`);
        assert.equal(inspection.rewriteRecommended, false, `${name}/${chatType}: ${entry.text}`);
      }
    }
  }
});

test('the same chat never sees the same fallback line twice in a row', () => {
  resetReplyVariantMemory();
  const event = { chatType: 'private', chatId: '10001', messageId: 'm-1' };
  const first = buildModelFallbackVariant({ event, error: { code: 'MODEL_TIMEOUT' } });
  const second = buildModelFallbackVariant({ event, error: { code: 'MODEL_TIMEOUT' } });

  assert.notEqual(first, second);
  assert.ok(VARIANT_POOLS['model-fallback-private'].some((entry) => entry.text === first));
  assert.ok(VARIANT_POOLS['model-fallback-private'].some((entry) => entry.text === second));

  const budgetFirst = buildBudgetFallbackVariant({ event });
  const budgetSecond = buildBudgetFallbackVariant({ event });
  assert.notEqual(budgetFirst, budgetSecond);
});

test('variant pools are selected by scene, route and sentiment', () => {
  resetReplyVariantMemory();
  const groupFallback = buildModelFallbackVariant({
    event: { chatType: 'group', chatId: '20001', messageId: 'g-1' },
  });
  assert.ok(VARIANT_POOLS['model-fallback-group'].some((entry) => entry.text === groupFallback));

  const knowledgeFallback = buildModelFallbackVariant({
    event: { chatType: 'private', chatId: '10002', messageId: 'k-1' },
    route: { category: 'knowledge_qa' },
  });
  assert.ok(VARIANT_POOLS['model-fallback-knowledge'].some((entry) => entry.text === knowledgeFallback));

  const support = buildDeescalatedVariant({ event: { chatId: '10003' }, intent: 'help' });
  assert.ok(VARIANT_POOLS['deescalated-support'].some((entry) => entry.text === support));
  const challenge = buildDeescalatedVariant({ event: { chatId: '10004' }, intent: 'challenge' });
  assert.ok(VARIANT_POOLS['deescalated-challenge'].some((entry) => entry.text === challenge));
  const positive = buildDeescalatedVariant({ event: { chatId: '10005' }, sentiment: 'positive' });
  assert.ok(VARIANT_POOLS['deescalated-positive'].some((entry) => entry.text === positive));
  const neutral = buildDeescalatedVariant({ event: { chatId: '10006' }, sentiment: 'neutral' });
  assert.ok(VARIANT_POOLS['deescalated-neutral'].some((entry) => entry.text === neutral));
});

test('tool acknowledgements keep the detail suffix and pick a tool-specific pool', () => {
  resetReplyVariantMemory();
  const reminder = buildToolAcknowledgementVariant({ tool: 'reminder_create', detail: '15 分钟后', chatId: '10001' });
  assert.match(reminder, /：15 分钟后$/);
  const prefix = reminder.replace(/：15 分钟后$/, '');
  assert.ok(VARIANT_POOLS['tool-ack-reminder'].some((entry) => entry.text.replace(/[。！]$/, '') === prefix));

  const bare = buildToolAcknowledgementVariant({ tool: 'unknown_tool', chatId: '10001' });
  assert.ok(VARIANT_POOLS['tool-ack-generic'].some((entry) => entry.text === bare));

  const memory = buildToolAcknowledgementVariant({ tool: 'memory_update', chatId: '10009' });
  assert.ok(VARIANT_POOLS['tool-ack-preference'].some((entry) => entry.text === memory));
});

test('pickReplyVariant is deterministic per seed and tolerates unknown pools', () => {
  resetReplyVariantMemory();
  const first = pickReplyVariant('model-fallback-private', { chatId: 'seeded', seed: 'fixed' });
  resetReplyVariantMemory();
  const second = pickReplyVariant('model-fallback-private', { chatId: 'seeded', seed: 'fixed' });
  assert.equal(first, second);
  assert.equal(pickReplyVariant('does-not-exist', { chatId: 'x' }), '');
});
