let runtimeServices = {
  queueManager: null,
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
