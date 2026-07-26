import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliveryKey, createDeliveryLedger } from './src/delivery-ledger.js';

test('delivery ledger allows one active delivery and suppresses duplicates after success', async () => {
  const records = [];
  const ledger = createDeliveryLedger({ records, now: () => new Date('2026-07-23T12:00:00Z') });

  const first = await ledger.claim('delivery-1', { kind: 'primary' });
  const competing = await ledger.claim('delivery-1', { kind: 'primary' });

  assert.equal(first.shouldSend, true);
  assert.equal(competing.shouldSend, false);
  assert.equal(competing.status, 'sending');

  await ledger.markSent('delivery-1', first.claimToken);
  const duplicate = await ledger.claim('delivery-1', { kind: 'primary' });
  assert.equal(duplicate.shouldSend, false);
  assert.equal(duplicate.status, 'sent');
  assert.equal(records[0].attempts, 1);
});

test('delivery ledger permits retry after a failed delivery', async () => {
  let now = new Date('2026-07-23T12:00:00Z');
  const records = [];
  const ledger = createDeliveryLedger({ records, now: () => now });

  const first = await ledger.claim('delivery-2');
  await ledger.markFailed('delivery-2', first.claimToken, new Error('onebot delivery unavailable'));
  now = new Date('2026-07-23T12:00:01Z');
  const retry = await ledger.claim('delivery-2');

  assert.equal(retry.shouldSend, true);
  assert.notEqual(retry.claimToken, first.claimToken);
  assert.equal(records[0].attempts, 2);
  assert.equal(records[0].lastError, '');
});

test('delivery ledger reclaims an expired sending lease', async () => {
  let now = new Date('2026-07-23T12:00:00Z');
  const records = [];
  const ledger = createDeliveryLedger({ records, now: () => now, leaseMs: 1000 });

  const first = await ledger.claim('delivery-3');
  now = new Date('2026-07-23T12:00:02Z');
  const reclaimed = await ledger.claim('delivery-3');

  assert.equal(first.shouldSend, true);
  assert.equal(reclaimed.shouldSend, true);
  assert.equal(records[0].attempts, 2);
});

test('delivery keys are stable across retries and separate delivery kinds', () => {
  const event = {
    platform: 'qq',
    chatType: 'private',
    chatId: 'user:1',
    userId: 'user:1',
    messageId: 'message:1',
    timestamp: 123,
  };

  assert.equal(
    buildDeliveryKey(event, 'primary'),
    'qq:private:user%3A1:message%3A1:primary'
  );
  assert.notEqual(buildDeliveryKey(event, 'primary'), buildDeliveryKey(event, 'voice'));
  assert.equal(buildDeliveryKey(event, 'primary', 'scheduler:task:slot'), 'scheduler:task:slot');
});

test('delivery ledger uses an atomic upsert when claiming a Mongo record', async () => {
  const calls = [];
  const model = {
    findOneAndUpdate: async (...args) => {
      calls.push(args);
      return { deliveryKey: 'mongo-delivery', status: 'sending', attempts: 1 };
    },
  };
  const ledger = createDeliveryLedger({
    DeliveryRecord: model,
    now: () => new Date('2026-07-23T12:00:00Z'),
  });

  const result = await ledger.claim('mongo-delivery', {
    platform: 'qq', chatType: 'private', chatId: 'u1', kind: 'primary',
  });

  assert.equal(result.shouldSend, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].deliveryKey, 'mongo-delivery');
  assert.equal(calls[0][2].upsert, true);
  assert.equal(calls[0][1].$inc.attempts, 1);
});

test('delivery ledger treats a duplicate-key race as an existing active delivery', async () => {
  const model = {
    findOneAndUpdate: async () => {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    },
    findOne: async () => ({ deliveryKey: 'race-delivery', status: 'sent' }),
  };
  const ledger = createDeliveryLedger({ DeliveryRecord: model });

  const result = await ledger.claim('race-delivery');

  assert.equal(result.shouldSend, false);
  assert.equal(result.status, 'sent');
});

test('delivery ledger fences a Mongo worker with a mismatched claim token', async () => {
  let capturedQuery = null;
  const model = {
    findOneAndUpdate: async (query) => {
      capturedQuery = query;
      return null;
    },
  };
  const ledger = createDeliveryLedger({ DeliveryRecord: model });

  await assert.rejects(
    () => ledger.markSent('token-delivery', 'claim-token'),
    (error) => error.code === 'DELIVERY_CLAIM_LOST'
  );
  assert.deepEqual(capturedQuery, {
    deliveryKey: 'token-delivery',
    claimToken: 'claim-token',
  });
});

test('delivery ledger persists and resumes an immutable multipart plan', async () => {
  const records = [];
  const ledger = createDeliveryLedger({ records });
  const firstClaim = await ledger.claim('planned-delivery');
  const first = await ledger.preparePlan('planned-delivery', firstClaim.claimToken, {
    type: 'segmented-text',
    text: 'firstsecond',
    segments: ['first', 'second'],
  });
  await ledger.markPartCompleted('planned-delivery', firstClaim.claimToken, 1);
  await ledger.markFailed('planned-delivery', firstClaim.claimToken, new Error('temporary failure'));

  const retryClaim = await ledger.claim('planned-delivery');
  const resumed = await ledger.preparePlan('planned-delivery', retryClaim.claimToken, {
    type: 'text',
    text: 'different',
    segments: ['different'],
  });

  assert.deepEqual(first.plan.segments, ['first', 'second']);
  assert.deepEqual(resumed.plan.segments, ['first', 'second']);
  assert.equal(resumed.completedParts, 1);
});

test('delivery ledger rejects stale multipart progress after lease takeover', async () => {
  let now = new Date('2026-07-27T00:00:00Z');
  const records = [];
  const ledger = createDeliveryLedger({ records, now: () => now, leaseMs: 1000 });
  const stale = await ledger.claim('fenced-plan');
  await ledger.preparePlan('fenced-plan', stale.claimToken, {
    type: 'segmented-text', segments: ['a', 'b'],
  });
  now = new Date('2026-07-27T00:00:02Z');
  const current = await ledger.claim('fenced-plan');

  await assert.rejects(
    () => ledger.markPartCompleted('fenced-plan', stale.claimToken, 1),
    (error) => error.code === 'DELIVERY_CLAIM_LOST'
  );
  const resumed = await ledger.preparePlan('fenced-plan', current.claimToken, {
    type: 'text', segments: ['different'],
  });
  assert.deepEqual(resumed.plan.segments, ['a', 'b']);
});
