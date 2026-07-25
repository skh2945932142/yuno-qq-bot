let runtimeServices = {
  queueManager: null,
  deliveryLedger: null,
  deliveryAdapter: null,
  protocolAdapter: null,
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

export function resetRuntimeServices() {
  runtimeServices = {
    queueManager: null,
    deliveryLedger: null,
    deliveryAdapter: null,
    protocolAdapter: null,
    readiness: {
      qdrant: { enabled: false, ready: false, reason: 'unknown' },
      voice: { enabled: false, ready: false, reason: 'unknown' },
    },
  };
}
