import { createDeliveryRequest } from '../contracts/delivery-request.js';

function makeMeta(request, kind) {
  return {
    platform: request.target.platform,
    chatType: request.target.chatType,
    chatId: request.target.chatId,
    sourceMessageId: String(request.event?.messageId || ''),
    kind,
  };
}

async function executeTracked(delivery, request, kind, task, key = '') {
  const deliveryKey = String(key || request.deliveryKey || '').trim();
  if (typeof delivery.executeTracked !== 'function') {
    const value = await task({ deliveryKey, status: 'untracked' });
    return { sent: value !== false, deduplicated: false, status: value === false ? 'not_sent' : 'sent', value, deliveryKey };
  }
  const result = await delivery.executeTracked(deliveryKey, makeMeta(request, kind), task);
  return { ...result, deliveryKey };
}

/**
 * The sole application service that may invoke the delivery port. The port is
 * supplied by the Koishi composition root and preserves ledger semantics.
 */
export function createDeliverReplyUseCase({ ports } = {}) {
  const defaultDelivery = ports?.delivery;
  if (!defaultDelivery?.sendReply) throw new Error('DELIVER_REPLY_PORT_REQUIRED');

  return async function deliverReply(replyPlan, options = {}) {
    const delivery = options.delivery || defaultDelivery;
    if (!delivery?.sendReply) throw new Error('DELIVER_REPLY_PORT_REQUIRED');
    const request = createDeliveryRequest(replyPlan, options);
    const primary = await executeTracked(delivery, request, request.kind, async () => {
      if (request.outputs.length === 0) return true;
      if (typeof delivery.sendStructuredReply === 'function') {
        return delivery.sendStructuredReply(request.target, request.outputs);
      }
      const text = request.outputs
        .filter((output) => output.type === 'text')
        .map((output) => output.text)
        .join('\n');
      return text ? delivery.sendReply(request.target, text) : false;
    }, request.deliveryKey);

    if (
      options.recordOutbound !== false
      && primary.sent
      && !primary.deduplicated
      && typeof ports?.logs?.recordOutbound === 'function'
    ) {
      const text = request.outputs
        .filter((output) => output.type === 'text')
        .map((output) => output.text)
        .join('\n')
        .trim();
      if (text) {
        await ports.logs.recordOutbound(request.event, text, {
          deliveryKey: primary.deliveryKey || request.deliveryKey,
        });
      }
    }

    let voice = null;
    if (request.voice.shouldSend && request.voice.audio && typeof delivery.sendVoice === 'function') {
      voice = await executeTracked(delivery, request, 'voice', () => (
        delivery.sendVoice(request.target, request.voice.audio)
      ), options.voiceDeliveryKey || '');
    }

    return { delivery: primary, voice };
  };
}
