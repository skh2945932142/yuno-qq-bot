import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';

export function createTraceContext(workflow, meta = {}) {
  return {
    traceId: randomUUID(),
    workflow,
    startedAt: Date.now(),
    meta: sanitizeMeta(meta),
    spans: [],
  };
}

function sanitizeMeta(meta = {}) {
  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

export async function withTraceSpan(trace, spanName, task, meta = {}) {
  const startedAt = Date.now();
  try {
    const result = await task();
    trace.spans.push({
      spanName,
      elapsedMs: Date.now() - startedAt,
      status: 'ok',
      meta: sanitizeMeta(meta),
    });
    return result;
  } catch (error) {
    trace.spans.push({
      spanName,
      elapsedMs: Date.now() - startedAt,
      status: 'error',
      meta: sanitizeMeta({
        ...meta,
        message: error.message,
      }),
    });
    throw error;
  }
}

export function logTraceEvent(trace, category, message, meta = {}) {
  logger.info(category, message, {
    traceId: trace.traceId,
    workflow: trace.workflow,
    ...sanitizeMeta(meta),
  });
}

export function finalizeTrace(trace, outcome = {}) {
  const elapsedMs = Date.now() - trace.startedAt;
  logger.info('trace', 'Workflow completed', {
    traceId: trace.traceId,
    workflow: trace.workflow,
    elapsedMs,
    steps: trace.spans.map((span) => ({
      name: span.spanName,
      ms: span.elapsedMs,
      status: span.status,
    })),
    ...sanitizeMeta(trace.meta),
    ...sanitizeMeta(outcome),
  });
}

export function failTrace(trace, error, meta = {}) {
  logger.error('trace', 'Workflow failed', {
    traceId: trace.traceId,
    workflow: trace.workflow,
    elapsedMs: Date.now() - trace.startedAt,
    message: error.message,
    steps: trace.spans.map((span) => ({
      name: span.spanName,
      ms: span.elapsedMs,
      status: span.status,
    })),
    ...sanitizeMeta(trace.meta),
    ...sanitizeMeta(meta),
  });
}
