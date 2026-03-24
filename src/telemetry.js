let telemetryState = {
  enabled: false,
  started: false,
  sdk: null,
};

export async function initializeTelemetry(config) {
  if (!config.otlpEndpoint || telemetryState.started) {
    return telemetryState;
  }

  try {
    const [{ NodeSDK }, { OTLPTraceExporter }] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
    ]);

    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({
        url: config.otlpEndpoint,
      }),
    });

    await sdk.start();
    telemetryState = {
      enabled: true,
      started: true,
      sdk,
    };
  } catch {
    telemetryState = {
      enabled: false,
      started: false,
      sdk: null,
    };
  }

  return telemetryState;
}

export async function shutdownTelemetry() {
  if (telemetryState.sdk?.shutdown) {
    await telemetryState.sdk.shutdown();
  }

  telemetryState = {
    enabled: false,
    started: false,
    sdk: null,
  };
}

export function getTelemetryStatus() {
  return {
    enabled: telemetryState.enabled,
    started: telemetryState.started,
  };
}
