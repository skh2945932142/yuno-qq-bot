import crypto from 'node:crypto';
import { DeliveryRecord } from './models.js';

function asDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toRecord(value) {
  return typeof value?.toObject === 'function' ? value.toObject() : value;
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function normalizeKeyPart(value, fallback) {
  const normalized = String(value ?? '').trim() || fallback;
  return encodeURIComponent(normalized);
}

export function buildDeliveryKey(event = {}, kind = 'primary', explicitKey = '') {
  const normalizedExplicitKey = String(explicitKey || '').trim();
  if (normalizedExplicitKey) return normalizedExplicitKey;

  const sourceMessageId = String(event.messageId || '').trim()
    || `${String(event.userId || 'unknown').trim()}:${Number(event.timestamp || 0) || 'unknown'}`;
  return [
    normalizeKeyPart(event.platform, 'qq'),
    normalizeKeyPart(event.chatType, 'group'),
    normalizeKeyPart(event.chatId, 'unknown'),
    normalizeKeyPart(sourceMessageId, 'unknown'),
    normalizeKeyPart(kind, 'primary'),
  ].join(':');
}

export function buildDeliveryMeta(event = {}, kind = 'primary') {
  return {
    platform: String(event.platform || 'qq'),
    chatType: String(event.chatType || 'group'),
    chatId: String(event.chatId || 'unknown'),
    sourceMessageId: String(event.messageId || ''),
    kind: String(kind || 'primary'),
  };
}

export async function executeTrackedDelivery({
  executeDelivery,
  event = {},
  kind = 'primary',
  task,
  explicitKey = '',
}) {
  const deliveryKey = buildDeliveryKey(event, kind, explicitKey);
  const run = async (deliveryContext = {}) => {
    const value = await task(deliveryContext);
    if (value === false) {
      const error = new Error(`Delivery did not send: ${kind}`);
      error.code = 'DELIVERY_NOT_SENT';
      throw error;
    }
    return value;
  };

  if (typeof executeDelivery !== 'function') {
    let deliveryPlan = null;
    let completedParts = 0;
    const deliveryContext = {
      deliveryKey,
      status: 'untracked',
      preparePlan: async (plan) => {
        deliveryPlan ||= structuredClone(plan);
        return { plan: structuredClone(deliveryPlan), completedParts };
      },
      replacePlanBeforeDelivery: async (plan) => {
        if (completedParts > 0) {
          const error = new Error(`Delivery plan already started: ${deliveryKey}`);
          error.code = 'DELIVERY_PLAN_STARTED';
          throw error;
        }
        deliveryPlan = structuredClone(plan);
        return { plan: structuredClone(deliveryPlan), completedParts };
      },
      markPartCompleted: async (count) => {
        completedParts = Math.max(completedParts, Number(count || 0));
        return { deliveryPlan, completedParts };
      },
    };
    return {
      sent: true,
      deduplicated: false,
      status: 'sent',
      value: await run(deliveryContext),
      deliveryKey,
    };
  }

  return {
    ...await executeDelivery(deliveryKey, buildDeliveryMeta(event, kind), run),
    deliveryKey,
  };
}

export function createDeliveryLedger(options = {}) {
  const records = Array.isArray(options.records) ? options.records : null;
  const model = options.DeliveryRecord || DeliveryRecord;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const leaseMs = Math.max(1000, Number(options.leaseMs || 60_000));

  async function claim(deliveryKey, meta = {}) {
    const normalizedKey = String(deliveryKey || '').trim();
    if (!normalizedKey) {
      return { shouldSend: true, claimToken: '', status: 'untracked' };
    }

    const claimedAt = asDate(now());
    const lockedUntil = new Date(claimedAt.getTime() + leaseMs);
    const claimToken = crypto.randomUUID();

    if (records) {
      let record = records.find((item) => item.deliveryKey === normalizedKey);
      if (record?.status === 'sent') {
        return { shouldSend: false, status: 'sent', record: { ...record } };
      }
      if (record?.status === 'sending' && asDate(record.lockedUntil).getTime() > claimedAt.getTime()) {
        return { shouldSend: false, status: 'sending', record: { ...record } };
      }
      if (!record) {
        record = {
          deliveryKey: normalizedKey,
          platform: String(meta.platform || 'qq'),
          chatType: String(meta.chatType || 'group'),
          chatId: String(meta.chatId || ''),
          sourceMessageId: String(meta.sourceMessageId || ''),
          kind: String(meta.kind || 'primary'),
          attempts: 0,
        };
        records.push(record);
      }
      record.status = 'sending';
      record.claimToken = claimToken;
      record.lockedUntil = lockedUntil;
      record.attempts = Number(record.attempts || 0) + 1;
      record.lastError = '';
      record.updatedAt = claimedAt;
      return { shouldSend: true, status: 'sending', claimToken, record: { ...record } };
    }

    try {
      const record = await model.findOneAndUpdate(
        {
          deliveryKey: normalizedKey,
          $or: [
            { status: 'pending' },
            { status: 'failed' },
            { status: 'sending', lockedUntil: { $lte: claimedAt } },
            { status: { $exists: false } },
          ],
        },
        {
          $setOnInsert: {
            deliveryKey: normalizedKey,
            platform: String(meta.platform || 'qq'),
            chatType: String(meta.chatType || 'group'),
            chatId: String(meta.chatId || 'unknown'),
            sourceMessageId: String(meta.sourceMessageId || ''),
            kind: String(meta.kind || 'primary'),
          },
          $set: {
            status: 'sending',
            claimToken,
            lockedUntil,
            lastError: '',
          },
          $inc: { attempts: 1 },
        },
        { upsert: true, returnDocument: 'after' }
      );
      return { shouldSend: true, status: 'sending', claimToken, record: toRecord(record) };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = toRecord(await model.findOne({ deliveryKey: normalizedKey }));
      return {
        shouldSend: false,
        status: existing?.status || 'sending',
        record: existing || null,
      };
    }
  }

  function raiseClaimLost(deliveryKey) {
    const error = new Error(`Delivery claim lost: ${deliveryKey}`);
    error.code = 'DELIVERY_CLAIM_LOST';
    throw error;
  }

  async function preparePlan(deliveryKey, claimToken, plan = {}) {
    const normalizedKey = String(deliveryKey || '').trim();
    if (!normalizedKey) return { plan, completedParts: 0 };

    if (records) {
      const record = records.find((item) => item.deliveryKey === normalizedKey
        && (!claimToken || item.claimToken === claimToken));
      if (!record) return raiseClaimLost(normalizedKey);
      if (!record.deliveryPlan) record.deliveryPlan = structuredClone(plan);
      return {
        plan: structuredClone(record.deliveryPlan),
        completedParts: Number(record.completedParts || 0),
      };
    }

    const ownershipQuery = { deliveryKey: normalizedKey };
    if (claimToken) ownershipQuery.claimToken = claimToken;
    const existing = toRecord(await model.findOne(ownershipQuery));
    if (!existing) return raiseClaimLost(normalizedKey);
    if (existing.deliveryPlan) {
      return {
        plan: existing.deliveryPlan,
        completedParts: Number(existing.completedParts || 0),
      };
    }

    const query = {
      ...ownershipQuery,
      $or: [
        { deliveryPlan: null },
        { deliveryPlan: { $exists: false } },
      ],
    };
    const updated = await model.findOneAndUpdate(
      query,
      { $set: { deliveryPlan: plan } },
      { returnDocument: 'after' }
    );
    const record = toRecord(updated);
    if (!record) return raiseClaimLost(normalizedKey);
    return {
      plan: record.deliveryPlan || plan,
      completedParts: Number(record.completedParts || 0),
    };
  }

  async function replacePlanBeforeDelivery(deliveryKey, claimToken, plan = {}) {
    const normalizedKey = String(deliveryKey || '').trim();
    if (!normalizedKey) return { plan, completedParts: 0 };

    if (records) {
      const record = records.find((item) => item.deliveryKey === normalizedKey
        && (!claimToken || item.claimToken === claimToken));
      if (!record) return raiseClaimLost(normalizedKey);
      if (Number(record.completedParts || 0) > 0) {
        const error = new Error(`Delivery plan already started: ${normalizedKey}`);
        error.code = 'DELIVERY_PLAN_STARTED';
        throw error;
      }
      record.deliveryPlan = structuredClone(plan);
      return { plan: structuredClone(record.deliveryPlan), completedParts: 0 };
    }

    const query = {
      deliveryKey: normalizedKey,
      completedParts: { $in: [0, null] },
    };
    if (claimToken) query.claimToken = claimToken;
    const updated = await model.findOneAndUpdate(
      query,
      { $set: { deliveryPlan: plan } },
      { returnDocument: 'after' }
    );
    if (!updated) return raiseClaimLost(normalizedKey);
    const record = toRecord(updated);
    return { plan: record.deliveryPlan || plan, completedParts: 0 };
  }

  async function markPartCompleted(deliveryKey, claimToken, completedParts) {
    const normalizedKey = String(deliveryKey || '').trim();
    if (!normalizedKey) return null;
    const normalizedCompletedParts = Math.max(0, Number(completedParts || 0));

    if (records) {
      const record = records.find((item) => item.deliveryKey === normalizedKey
        && (!claimToken || item.claimToken === claimToken));
      if (!record) return raiseClaimLost(normalizedKey);
      record.completedParts = Math.max(Number(record.completedParts || 0), normalizedCompletedParts);
      return { ...record };
    }

    const query = { deliveryKey: normalizedKey };
    if (claimToken) query.claimToken = claimToken;
    const updated = await model.findOneAndUpdate(
      query,
      { $max: { completedParts: normalizedCompletedParts } },
      { returnDocument: 'after' }
    );
    if (!updated) return raiseClaimLost(normalizedKey);
    return toRecord(updated);
  }

  async function markSent(deliveryKey, claimToken) {
    const normalizedKey = String(deliveryKey || '').trim();
    if (!normalizedKey) return null;
    const sentAt = asDate(now());

    if (records) {
      const record = records.find((item) => item.deliveryKey === normalizedKey
        && (!claimToken || item.claimToken === claimToken));
      if (!record) return raiseClaimLost(normalizedKey);
      record.status = 'sent';
      record.claimToken = '';
      record.lockedUntil = null;
      record.sentAt = sentAt;
      record.lastError = '';
      record.updatedAt = sentAt;
      return { ...record };
    }

    const query = { deliveryKey: normalizedKey };
    if (claimToken) query.claimToken = claimToken;
    const updated = await model.findOneAndUpdate(
      query,
      {
        $set: {
          status: 'sent',
          claimToken: '',
          lockedUntil: null,
          sentAt,
          lastError: '',
        },
      },
      { returnDocument: 'after' }
    );
    if (!updated) return raiseClaimLost(normalizedKey);
    return toRecord(updated);
  }

  async function markFailed(deliveryKey, claimToken, error) {
    const normalizedKey = String(deliveryKey || '').trim();
    if (!normalizedKey) return null;
    const failedAt = asDate(now());
    const lastError = String(error?.message || error || 'delivery-failed');

    if (records) {
      const record = records.find((item) => item.deliveryKey === normalizedKey
        && (!claimToken || item.claimToken === claimToken));
      if (!record) return null;
      record.status = 'failed';
      record.claimToken = '';
      record.lockedUntil = null;
      record.lastError = lastError;
      record.updatedAt = failedAt;
      return { ...record };
    }

    const query = { deliveryKey: normalizedKey };
    if (claimToken) query.claimToken = claimToken;
    const updated = await model.findOneAndUpdate(
      query,
      {
        $set: {
          status: 'failed',
          claimToken: '',
          lockedUntil: null,
          lastError,
        },
      },
      { returnDocument: 'after' }
    );
    return updated ? toRecord(updated) : null;
  }

  async function execute(deliveryKey, meta, task) {
    const deliveryClaim = await claim(deliveryKey, meta);
    if (!deliveryClaim.shouldSend) {
      return { sent: false, deduplicated: true, status: deliveryClaim.status, value: null };
    }

    const deliveryContext = {
      deliveryKey,
      claimToken: deliveryClaim.claimToken,
      status: deliveryClaim.status,
      preparePlan: (plan) => preparePlan(deliveryKey, deliveryClaim.claimToken, plan),
      replacePlanBeforeDelivery: (plan) => replacePlanBeforeDelivery(deliveryKey, deliveryClaim.claimToken, plan),
      markPartCompleted: (count) => markPartCompleted(deliveryKey, deliveryClaim.claimToken, count),
    };

    try {
      const value = await task(deliveryContext);
      await markSent(deliveryKey, deliveryClaim.claimToken);
      return { sent: true, deduplicated: false, status: 'sent', value };
    } catch (error) {
      await markFailed(deliveryKey, deliveryClaim.claimToken, error).catch(() => {});
      throw error;
    }
  }

  return {
    claim,
    preparePlan,
    replacePlanBeforeDelivery,
    markPartCompleted,
    markSent,
    markFailed,
    execute,
  };
}
