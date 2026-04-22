let runtimeServices = {
  queueManager: null,
  readiness: {
    qdrant: { enabled: false, ready: false, reason: 'unknown' },
    voice: { enabled: false, ready: false, reason: 'unknown' },
  },
};

export function setRuntimeServices(nextServices = {}) {
  runtimeServices = {
    ...runtimeServices,
    ...nextServices,
  };
}

export function getRuntimeServices() {
  return runtimeServices;
}
