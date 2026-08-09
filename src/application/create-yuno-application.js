import { createApplicationJob, normalizeApplicationJob } from './contracts/queue-job.js';
import { createDecideReplyUseCase } from './use-cases/decide-reply.js';
import { createGenerateReplyUseCase } from './use-cases/generate-reply.js';
import { createDeliverReplyUseCase } from './use-cases/deliver-reply.js';
import { createPersistReplyUseCase } from './use-cases/persist-reply.js';
import { createHandleInboundEventUseCase } from './use-cases/handle-inbound-event.js';

/**
 * The application facade is the only dependency Yuno entry points need. Ports
 * are composed at runtime; infrastructure remains outside this module.
 */
export function createYunoApplication({ config, ports, legacyWorkflow } = {}) {
  if (!config) throw new Error('YUNO_APPLICATION_CONFIG_REQUIRED');
  if (!ports) throw new Error('YUNO_APPLICATION_PORTS_REQUIRED');
  if (!legacyWorkflow) throw new Error('YUNO_APPLICATION_LEGACY_WORKFLOW_REQUIRED');

  const decideReply = createDecideReplyUseCase({ config, ports, legacyWorkflow });
  const generateReply = createGenerateReplyUseCase({ config, ports, legacyWorkflow });
  const deliverReply = createDeliverReplyUseCase({ config, ports });
  const persistReply = createPersistReplyUseCase({ config, ports, legacyWorkflow });
  const handleInboundEvent = createHandleInboundEventUseCase({
    config,
    ports,
    legacyWorkflow,
    decideReply,
    generateReply,
    deliverReply,
    persistReply,
  });

  const handleReplyJob = async (payload, job = {}, options = {}) => {
    const normalized = normalizeApplicationJob(payload, 'reply');
    const request = normalized.version === 0 ? payload : normalized.request;
    return legacyWorkflow.processReplyJob(request, {
      ...options,
      queueJobId: options.queueJobId || job.id,
      runtimeConfig: options.runtimeConfig || config,
    });
  };
  const handlePersistJob = async (payload, job = {}, options = {}) => {
    const normalized = normalizeApplicationJob(payload, 'persist');
    const request = normalized.version === 0 ? payload : normalized.request;
    return legacyWorkflow.processPersistJob(request, {
      ...options,
      queueJobId: options.queueJobId || job.id,
      runtimeConfig: options.runtimeConfig || config,
    });
  };
  const enqueueReply = async (request, options = {}) => {
    const job = createApplicationJob('reply', request);
    if (typeof ports.jobs?.enqueueReply === 'function') {
      return ports.jobs.enqueueReply(job, options);
    }
    return handleReplyJob(job, { id: options.jobId || '' }, options);
  };
  const enqueuePersist = async (request, options = {}) => {
    const job = createApplicationJob('persist', request);
    if (typeof ports.jobs?.enqueuePersist === 'function') {
      return ports.jobs.enqueuePersist(job, options);
    }
    return handlePersistJob(job, { id: options.jobId || '' }, options);
  };

  return Object.freeze({
    decideReply,
    generateReply,
    deliverReply,
    persistReply,
    handleInboundEvent,
    handleReplyJob,
    handlePersistJob,
    enqueueReply,
    enqueuePersist,
  });
}
