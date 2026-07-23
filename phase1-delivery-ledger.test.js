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
  await ledger.markFailed('delivery-2', first.claimToken, new Error('napcat unavailable'));
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

test('delivery ledger never marks a Mongo record sent with a mismatched claim token', async () => {
  let capturedQuery = null;
  const model = {
    findOneAndUpdate: async (query) => {
      capturedQuery = query;
      return null;
    },
  };
  const ledger = createDeliveryLedger({ DeliveryRecord: model });

  const result = await ledger.markSent('token-delivery', 'claim-token');

  assert.equal(result, null);
  assert.deepEqual(capturedQuery, {
    deliveryKey: 'token-delivery',
    claimToken: 'claim-token',
  });
});
