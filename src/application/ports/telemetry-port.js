export function createTelemetryPort(operations = {}) {
  const noop = () => {};
  return Object.freeze({
    logger: operations.logger || { info: noop, warn: noop, error: noop },
    recordMetric: typeof operations.recordMetric === 'function' ? operations.recordMetric : noop,
    createTrace: typeof operations.createTrace === 'function' ? operations.createTrace : null,
  });
}
