import { createInboundMessage } from '../contracts/inbound-message.js';
import { createApplicationJob } from '../contracts/queue-job.js';

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function createDeliveryOverride(defaultDelivery, deps = {}) {
  if (!defaultDelivery) return null;
  return {
    ...defaultDelivery,
    sendReply: deps.sendReply || defaultDelivery.sendReply,
    sendStructuredReply: deps.sendStructuredReply || defaultDelivery.sendStructuredReply,
    sendVoice: deps.sendVoice || defaultDelivery.sendVoice,
    executeTracked: hasOwn(deps, 'executeDelivery') ? deps.executeDelivery : defaultDelivery.executeTracked,
  };
}

function toPersistenceRequest(jobData = {}) {
  const {
    event,
    contextSnapshot = {},
    taskMode = 'all',
    ...payload
  } = jobData;
  return { event, contextSnapshot, payload, taskMode };
}

/**
 * Coordinates the existing inbound lifecycle through explicit decision,
 * generation, delivery and persistence boundaries. Koishi remains outside this
 * application use case, and only DeliverReply receives a delivery port.
 */
export function createHandleInboundEventUseCase({
  config,
  ports,
  legacyWorkflow,
  decideReply,
  generateReply,
  deliverReply,
  persistReply,
} = {}) {
  if (!legacyWorkflow?.handleInboundEvent) {
    throw new Error('HANDLE_INBOUND_LEGACY_WORKFLOW_REQUIRED');
  }
  if (
    typeof decideReply !== 'function'
    || typeof generateReply !== 'function'
    || typeof deliverReply !== 'function'
    || typeof persistReply !== 'function'
  ) {
    throw new Error('HANDLE_INBOUND_USE_CASES_REQUIRED');
  }

  return async function handleInboundEvent(event, options = {}) {
    const inbound = createInboundMessage(event);
    const lifecycleDeps = options.deps || {};
    // Yuno core carries send/capture functions in decisionOptions.deps while
    // lifecycle-only hooks remain in options.deps. Keep both scopes distinct.
    const conversationDeps = options.decisionOptions?.deps || lifecycleDeps;
    return legacyWorkflow.handleInboundEvent(inbound, {
      ...options,
      decisionOptions: {
        ...(options.decisionOptions || {}),
        runtimeConfig: options.decisionOptions?.runtimeConfig || config,
      },
      deps: {
        ...lifecycleDeps,
        shouldRespondToEvent: (nextEvent, decisionOptions = {}) => decideReply(nextEvent, {
          ...decisionOptions,
          deps: decisionOptions.deps || conversationDeps,
        }),
        onReplyApproved: async ({ event: approvedEvent, decision, ...rest }) => {
          const generated = await generateReply(approvedEvent, decision, {
            ...options,
            ...rest,
            deps: conversationDeps,
            runtimeConfig: options.runtimeConfig || config,
          });
          const replyPlan = generated.replyPlan;
          if (!replyPlan) return generated.replyText;

          const delivery = await deliverReply(replyPlan, {
            delivery: createDeliveryOverride(ports?.delivery, conversationDeps),
            deliveryKey: options.deliveryKey || replyPlan.deliveryKey,
            voiceDeliveryKey: options.voiceDeliveryKey,
            recordOutbound: options.responseMode !== 'capture',
          });

          const persistence = replyPlan.persistence;
          if (persistence) {
            const request = toPersistenceRequest(persistence);
            const persistOptions = {
              ...options,
              ...rest,
              deps: conversationDeps,
              runtimeConfig: options.runtimeConfig || config,
            };
            const shouldPersistInline = options.persistInline ?? options.responseMode === 'send';
            const enqueuePersist = ports?.jobs?.enqueuePersist;
            if (!shouldPersistInline && typeof enqueuePersist === 'function') {
              const queueOptions = replyPlan.metadata.queueOptions || {};
              await enqueuePersist(createApplicationJob('persist', persistence), queueOptions);
            } else {
              await persistReply(request, persistOptions);
            }
          }

          return generated.replyText || delivery?.delivery?.value || null;
        },
      },
    });
  };
}
