export const APPLICATION_JOB_VERSION = 1;

export function createApplicationJob(kind, request, metadata = {}) {
  const normalizedKind = String(kind || '').trim();
  if (!normalizedKind) {
    throw new Error('APPLICATION_JOB_KIND_REQUIRED');
  }
  return Object.freeze({
    version: APPLICATION_JOB_VERSION,
    kind: normalizedKind,
    request,
    metadata: Object.freeze({ ...metadata }),
  });
}

/**
 * Accept legacy payloads while workers drain jobs enqueued before the refactor.
 */
export function normalizeApplicationJob(payload = {}, fallbackKind = '') {
  if (Number(payload?.version) === APPLICATION_JOB_VERSION && payload?.kind) {
    return payload;
  }
  return {
    version: 0,
    kind: String(payload?.kind || fallbackKind || 'legacy').trim(),
    request: payload,
    metadata: {},
  };
}
