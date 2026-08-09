import { isInboundMessage } from './inbound-message.js';

/**
 * A decision is deliberately independent of delivery and persistence. It may
 * carry loaded context so generation does not need to query the same state.
 */
export function createReplyDecision({ event, analysis = {}, context = null, task = null, trace = null } = {}) {
  if (!isInboundMessage(event)) {
    throw new Error('REPLY_DECISION_EVENT_REQUIRED');
  }

  const shouldRespond = Boolean(analysis.shouldRespond);
  return Object.freeze({
    event,
    analysis: Object.freeze({
      ...analysis,
      shouldRespond,
      reason: String(analysis.reason || (shouldRespond ? 'approved' : 'suppressed')),
    }),
    context,
    task,
    trace,
  });
}

export function isReplyApproved(decision) {
  return Boolean(decision?.analysis?.shouldRespond);
}
