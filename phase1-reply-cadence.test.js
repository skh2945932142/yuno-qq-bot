import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededRandom, resolveReplyCadence } from './src/reply-cadence.js';

const NEUTRAL_RANDOM = () => 0.5;

function createEvent(overrides = {}) {
  return {
    platform: 'qq',
    chatType: 'private',
    chatId: '10001',
    userId: '10001',
    messageId: 'm-1',
    rawText: '你在忙吗在忙吗你',
    text: '你在忙吗在忙吗你',
    ...overrides,
  };
}

test('resolveReplyCadence adds reading time on top of the scene baseline', () => {
  const cadence = resolveReplyCadence({
    event: createEvent(),
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
  });

  // private baseline 520 + 8 chars * 12ms reading time, no jitter at random()=0.5
  assert.equal(cadence.preDelayMs, 616);
  assert.equal(cadence.reason, 'cadence');
  assert.deepEqual(cadence.segmentDelays, [0]);
});

test('resolveReplyCadence caps reading time and clamps the pre delay window', () => {
  const long = resolveReplyCadence({
    event: createEvent({ rawText: '字'.repeat(400), text: '字'.repeat(400) }),
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
  });
  assert.equal(long.preDelayMs, 1720);

  const clamped = resolveReplyCadence({
    event: createEvent({ rawText: '字'.repeat(400), text: '字'.repeat(400) }),
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
    runtimeConfig: { replyCadenceMaxPreDelayMs: 900 },
  });
  assert.equal(clamped.preDelayMs, 900);

  const floored = resolveReplyCadence({
    event: createEvent({ rawText: '', text: '' }),
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
    runtimeConfig: { replyCadenceMinPreDelayMs: 1500 },
  });
  assert.equal(floored.preDelayMs, 1500);
});

test('resolveReplyCadence reacts faster when irritated and slower when withdrawn', () => {
  const base = resolveReplyCadence({
    event: createEvent(),
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
  }).preDelayMs;
  const fast = resolveReplyCadence({
    event: createEvent(),
    emotionResult: { emotion: 'IRRITABLE' },
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
  }).preDelayMs;
  const slow = resolveReplyCadence({
    event: createEvent(),
    emotionResult: { emotion: 'SAD' },
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
  }).preDelayMs;
  const poke = resolveReplyCadence({
    event: createEvent({ chatType: 'group', chatId: '20001' }),
    route: { category: 'poke' },
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
  }).preDelayMs;
  const knowledge = resolveReplyCadence({
    event: createEvent(),
    route: { category: 'knowledge_qa' },
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
  }).preDelayMs;

  assert.ok(fast < base, `${fast} < ${base}`);
  assert.ok(slow > base, `${slow} > ${base}`);
  assert.ok(poke < base, `${poke} < ${base}`);
  assert.ok(knowledge > base, `${knowledge} > ${base}`);
});

test('resolveReplyCadence jitter stays inside the configured ratio and is reproducible', () => {
  const event = createEvent();
  const low = resolveReplyCadence({ event, segments: ['一句话'], random: () => 0 }).preDelayMs;
  const high = resolveReplyCadence({ event, segments: ['一句话'], random: () => 1 }).preDelayMs;
  assert.equal(low, Math.round(616 * 0.75));
  assert.equal(high, Math.round(616 * 1.25));

  const first = resolveReplyCadence({ event, segments: ['一句话'] });
  const second = resolveReplyCadence({ event, segments: ['一句话'] });
  assert.deepEqual(first, second);

  const seeded = createSeededRandom('cadence-seed');
  const values = [seeded(), seeded(), seeded()];
  assert.ok(values.every((value) => value >= 0 && value < 1));
  const repeat = createSeededRandom('cadence-seed');
  assert.deepEqual([repeat(), repeat(), repeat()], values);
});

test('resolveReplyCadence keeps segment delays monotonic in segment length', () => {
  const cadence = resolveReplyCadence({
    event: createEvent(),
    segments: ['开头', '中'.repeat(12), '尾'.repeat(24), '补'.repeat(60)],
    random: NEUTRAL_RANDOM,
  });

  assert.equal(cadence.segmentDelays[0], 0);
  assert.deepEqual(cadence.segmentDelays.slice(1), [840, 1680, 2600]);
  for (let index = 2; index < cadence.segmentDelays.length; index += 1) {
    assert.ok(cadence.segmentDelays[index] >= cadence.segmentDelays[index - 1]);
  }
});

test('resolveReplyCadence compresses and then collapses under a tight budget', () => {
  const input = {
    event: createEvent(),
    segments: ['开头', '中'.repeat(12)],
    random: NEUTRAL_RANDOM,
  };
  const full = resolveReplyCadence(input);
  const total = full.preDelayMs + full.segmentDelays.reduce((sum, value) => sum + value, 0);

  const roomy = resolveReplyCadence({ ...input, remainingBudgetMs: total + 800 });
  assert.equal(roomy.reason, 'cadence');
  assert.deepEqual(roomy, full);

  const compressed = resolveReplyCadence({ ...input, remainingBudgetMs: 800 + Math.round(total / 2) });
  assert.equal(compressed.reason, 'budget-compressed');
  const compressedTotal = compressed.preDelayMs + compressed.segmentDelays.reduce((sum, value) => sum + value, 0);
  assert.ok(compressedTotal < total, `${compressedTotal} < ${total}`);
  assert.ok(compressedTotal <= Math.round(total / 2) + 2);

  const collapsed = resolveReplyCadence({ ...input, remainingBudgetMs: 500 });
  assert.equal(collapsed.reason, 'budget-collapsed');
  assert.equal(collapsed.preDelayMs, 0);
  assert.deepEqual(collapsed.segmentDelays, [0, 0]);
});

test('resolveReplyCadence credits time already spent generating the reply', () => {
  const base = {
    event: createEvent({ rawText: '在想一个问题，你怎么看', text: '在想一个问题，你怎么看' }),
    segments: ['先说一句', '再补一句'],
    random: NEUTRAL_RANDOM,
  };

  const cold = resolveReplyCadence(base);
  const afterFastModel = resolveReplyCadence({ ...base, elapsedMs: 200 });
  const afterSlowModel = resolveReplyCadence({ ...base, elapsedMs: 8000 });

  assert.ok(cold.preDelayMs > 0);
  assert.equal(afterFastModel.preDelayMs, Math.max(0, cold.preDelayMs - 200));
  // A slow model call already made the user wait, so nothing is left to simulate.
  assert.equal(afterSlowModel.preDelayMs, 0);
  // Segment pauses sit between bubbles and are unrelated to generation time.
  assert.deepEqual(afterSlowModel.segmentDelays, cold.segmentDelays);
});

test('resolveReplyCadence ignores a negative or unusable elapsed value', () => {
  const base = {
    event: createEvent(),
    segments: ['一句话'],
    random: NEUTRAL_RANDOM,
  };

  const cold = resolveReplyCadence(base);
  assert.equal(resolveReplyCadence({ ...base, elapsedMs: -500 }).preDelayMs, cold.preDelayMs);
  assert.equal(resolveReplyCadence({ ...base, elapsedMs: Number.NaN }).preDelayMs, cold.preDelayMs);
});

test('resolveReplyCadence returns a zero plan when cadence is disabled', () => {
  const cadence = resolveReplyCadence({
    event: createEvent(),
    segments: ['一句话', '第二句'],
    runtimeConfig: { replyCadenceEnabled: false },
  });

  assert.equal(cadence.preDelayMs, 0);
  assert.deepEqual(cadence.segmentDelays, [0, 0]);
  assert.equal(cadence.reason, 'disabled');
});
