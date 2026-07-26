import { config } from './config.js';
import { buildSessionKey } from './chat/session.js';
import { parseCommand } from './command-parser.js';
import { recordWorkflowMetric } from './metrics.js';

function normalizePositiveNumber(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.round(parsed) : fallback;
}

function resolveWindowMs(options = {}) {
  return normalizePositiveNumber(
    options.windowMs ?? options.privateMessageAggregationWindowMs,
    config.privateMessageAggregationWindowMs || 1200,
    1
  );
}

function resolveMaxWindowMs(options = {}, windowMs) {
  const configured = normalizePositiveNumber(
    options.maxWindowMs ?? options.privateMessageAggregationMaxWindowMs,
    config.privateMessageAggregationMaxWindowMs || 5000,
    windowMs
  );
  return Math.max(windowMs, configured);
}

export function shouldAggregatePrivateEvent(event = {}, runtimeConfig = config) {
  if (!runtimeConfig.privateMessageAggregationEnabled) return false;
  if (event.chatType !== 'private') return false;
  if (event.source?.postType === 'notice') return false;

  const text = String(event.rawText || event.text || '').trim();
  if (!text && !(event.attachments || []).length) return false;
  if (parseCommand(text)) return false;
  return true;
}

export function mergeAggregatedEvents(events = []) {
  const normalized = events.filter(Boolean);
  if (normalized.length <= 1) return normalized[0] || null;

  const joinTexts = (selector) => normalized
    .map((item) => String(selector(item) || '').trim())
    .filter(Boolean)
    .join('\n');

  return {
    ...normalized[normalized.length - 1],
    rawText: joinTexts((item) => item.rawText),
    text: joinTexts((item) => item.text ?? item.rawText),
    attachments: normalized.flatMap((item) => item.attachments || []),
    aggregatedCount: normalized.length,
    aggregatedMessageIds: normalized.map((item) => item.messageId).filter(Boolean),
  };
}

export function createPrivateMessageAggregator(options = {}) {
  const runtimeConfig = options.runtimeConfig || options;
  const windowMs = resolveWindowMs(runtimeConfig);
  const maxWindowMs = resolveMaxWindowMs(runtimeConfig, windowMs);
  const sessions = new Map();
  let sequence = 0;
  let closed = false;

  function getSession(key) {
    if (!sessions.has(key)) {
      sessions.set(key, {
        entries: [],
        processing: false,
        activePromise: null,
        timer: null,
      });
    }
    return sessions.get(key);
  }

  function cleanup(key, session) {
    if (!session.processing && session.entries.length === 0 && !session.timer) {
      sessions.delete(key);
    }
  }

  function settle(entry, outcome, error = null) {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.reservationTimer) clearTimeout(entry.reservationTimer);
    entry.reservationTimer = null;
    if (error) entry.reject(error);
    else entry.resolve(outcome);
  }

  function runEntry(key, session, entry) {
    session.processing = true;
    session.activePromise = (async () => {
      try {
        const result = await entry.process(entry.event);
        settle(entry, { type: 'processed', event: entry.event, result });
      } catch (error) {
        settle(entry, null, error);
      } finally {
        session.processing = false;
        session.activePromise = null;
        queueMicrotask(() => pump(key));
      }
    })();
  }

  function runBatch(key, session, batch) {
    session.processing = true;
    const mergedEvent = mergeAggregatedEvents(batch.map((entry) => entry.event));
    session.activePromise = (async () => {
      try {
        const result = await batch.at(-1).process(mergedEvent);
        batch.forEach((entry, index) => settle(entry, {
          type: index === batch.length - 1 ? 'processed' : 'superseded',
          event: mergedEvent,
          result,
        }));
        if (batch.length > 1) {
          recordWorkflowMetric('yuno_private_messages_aggregated_total', batch.length, {
            chat_type: 'private',
          });
        }
      } catch (error) {
        batch.forEach((entry) => settle(entry, null, error));
      } finally {
        session.processing = false;
        session.activePromise = null;
        queueMicrotask(() => pump(key));
      }
    })();
  }

  function scheduleBatch(key, session, head) {
    if (session.timer) clearTimeout(session.timer);
    const now = Date.now();
    const deadline = head.reservedAt + maxWindowMs;
    const delayMs = Math.max(0, Math.min(windowMs, deadline - now));
    session.timer = setTimeout(() => {
      session.timer = null;
      pump(key, { forceBatch: true });
    }, delayMs);
  }

  function pump(key, { forceBatch = false } = {}) {
    const session = sessions.get(key);
    if (!session || session.processing) return;

    while (session.entries[0]?.submitted && !session.entries[0].accepted) {
      const skipped = session.entries.shift();
      settle(skipped, { type: closed ? 'cancelled' : 'skipped' });
    }

    const head = session.entries[0];
    if (!head) {
      if (session.timer) clearTimeout(session.timer);
      session.timer = null;
      cleanup(key, session);
      return;
    }
    if (!head.submitted) return;

    if (!head.aggregate) {
      if (session.timer) clearTimeout(session.timer);
      session.timer = null;
      session.entries.shift();
      runEntry(key, session, head);
      return;
    }

    const batch = [];
    for (const entry of session.entries) {
      if (!entry.submitted || !entry.accepted || !entry.aggregate) break;
      batch.push(entry);
    }
    const barrier = session.entries[batch.length];
    const hardDeadlineReached = Date.now() >= head.reservedAt + maxWindowMs;
    const shouldFlush = forceBatch
      || closed
      || hardDeadlineReached
      || (barrier?.submitted && (!barrier.accepted || !barrier.aggregate));

    if (!shouldFlush) {
      scheduleBatch(key, session, head);
      return;
    }

    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    session.entries.splice(0, batch.length);
    runBatch(key, session, batch);
  }

  function reserve(event, reserveOptions = {}) {
    const key = buildSessionKey(event);
    const session = getSession(key);
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const entry = {
      id: ++sequence,
      key,
      event,
      aggregate: shouldAggregatePrivateEvent(event, runtimeConfig),
      reservedAt: Number(reserveOptions.now || Date.now()),
      submitted: false,
      accepted: false,
      process: null,
      settled: false,
      reservationTimer: null,
      promise,
      resolve,
      reject,
    };
    entry.reservationTimer = setTimeout(() => {
      if (entry.submitted || entry.settled) return;
      entry.expired = true;
      const currentSession = sessions.get(key);
      const index = currentSession?.entries.indexOf(entry) ?? -1;
      if (index >= 0) currentSession.entries.splice(index, 1);
      pump(key);
    }, maxWindowMs);
    session.entries.push(entry);
    return entry;
  }

  function submit(reservation, { accepted = true, process = null } = {}) {
    if (!reservation || reservation.settled) {
      return Promise.resolve({ type: 'cancelled' });
    }
    if (reservation.expired) {
      reservation.expired = false;
      reservation.reservedAt = Date.now();
      getSession(reservation.key).entries.push(reservation);
    }
    reservation.submitted = true;
    reservation.accepted = Boolean(accepted) && !closed;
    reservation.process = typeof process === 'function' ? process : async () => null;
    pump(reservation.key);
    return reservation.promise;
  }

  async function close({ flush = true } = {}) {
    closed = true;
    const waits = [];
    for (const [key, session] of sessions) {
      if (session.activePromise) waits.push(session.activePromise.catch(() => null));
      for (const entry of session.entries) {
        waits.push(entry.promise.catch(() => null));
        if (!entry.submitted) {
          entry.submitted = true;
          entry.accepted = false;
        }
      }
      if (flush) pump(key, { forceBatch: true });
      else {
        if (session.timer) clearTimeout(session.timer);
        session.timer = null;
        for (const entry of session.entries.splice(0)) {
          settle(entry, { type: 'cancelled' });
        }
        cleanup(key, session);
      }
    }
    await Promise.all(waits);
  }

  return {
    reserve,
    submit,
    close,
    size() {
      return [...sessions.values()].reduce((count, session) => count + session.entries.length, 0);
    },
  };
}
