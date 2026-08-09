import { createReplyPlan } from './reply-plan.js';

/**
 * Stable input for the only layer allowed to trigger a QQ delivery.
 */
export function createDeliveryRequest(replyPlan = {}, overrides = {}) {
  const plan = createReplyPlan({ ...replyPlan, ...overrides });
  if (!plan.target.chatId) {
    throw new Error('DELIVERY_REQUEST_CHAT_ID_REQUIRED');
  }
  return Object.freeze({
    kind: String(overrides.kind || plan.metadata.deliveryKind || 'primary'),
    event: plan.event,
    target: plan.target,
    outputs: plan.outputs,
    voice: plan.voice,
    deliveryKey: String(overrides.deliveryKey || plan.deliveryKey || '').trim(),
    metadata: plan.metadata,
  });
}
