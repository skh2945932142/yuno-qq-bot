import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { recordWorkflowMetric } from './metrics.js';

function sanitizeMeta(meta = {}) {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined)
  );
}

export function createTraceContext(workflow, meta = {}) {
  return {
    traceId: randomUUID(),
    workflow,
    startedAt: Date.now(),
    meta: sanitizeMeta(meta),
    spans: [],
  };
}

export async function withTraceSpan(trace, spanName, task, meta = {}) {
  const startedAt = Date.now();
  try {
    const result = await task();
    const elapsedMs = Date.now() - startedAt;
    trace.spans.push({
      spanName,
      elapsedMs,
      status: 'ok',
      meta: sanitizeMeta(meta),
    });
    recordWorkflowMetric('yuno_span_elapsed_ms', elapsedMs, {
      workflow: trace.workflow,
      span: spanName,
      status: 'ok',
    }, 'histogram');
    return result;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    trace.spans.push({
      spanName,
      elapsedMs,
      status: 'error',
      meta: sanitizeMeta({
        ...meta,
        message: error.message,
      }),
    });
    recordWorkflowMetric('yuno_span_elapsed_ms', elapsedMs, {
      workflow: trace.workflow,
      span: spanName,
      status: 'error',
    }, 'histogram');
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
  recordWorkflowMetric('yuno_workflow_completed_total', 1, {
    workflow: trace.workflow,
    outcome: 'success',
  });
  recordWorkflowMetric('yuno_workflow_elapsed_ms', elapsedMs, {
    workflow: trace.workflow,
  }, 'histogram');
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
  recordWorkflowMetric('yuno_workflow_completed_total', 1, {
    workflow: trace.workflow,
    outcome: 'error',
  });
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
