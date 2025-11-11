import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  environment: string;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  metricIntervalMillis: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

let sdk: NodeSDK | null = null;
let telemetryEnabled = false;

function resolveDiagLevel(level: TelemetryConfig['logLevel']): DiagLogLevel {
  switch (level) {
    case 'debug':
      return DiagLogLevel.DEBUG;
    case 'info':
      return DiagLogLevel.INFO;
    case 'warn':
      return DiagLogLevel.WARN;
    case 'error':
      return DiagLogLevel.ERROR;
    default:
      return DiagLogLevel.WARN;
  }
}

function buildOtlpUrl(endpoint: string, suffix: '/v1/traces' | '/v1/metrics'): string {
  const trimmed = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  return `${trimmed}${suffix}`;
}

export async function initializeTelemetry(config: TelemetryConfig): Promise<void> {
  if (!config.enabled) {
    telemetryEnabled = false;
    return;
  }

  if (!config.otlpEndpoint) {
    diag.warn('Telemetry enabled but OTLP endpoint not configured - skipping initialization');
    telemetryEnabled = false;
    return;
  }

  if (sdk) {
    telemetryEnabled = true;
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), resolveDiagLevel(config.logLevel));

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment,
  });

  const instrumentations = [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new IORedisInstrumentation(),
    new PgInstrumentation(),
  ];

  const traceExporter = config.otlpEndpoint
    ? new OTLPTraceExporter({
        url: buildOtlpUrl(config.otlpEndpoint, '/v1/traces'),
        headers: config.otlpHeaders,
      })
    : undefined;

  const metricExporter = config.otlpEndpoint
    ? new OTLPMetricExporter({
        url: buildOtlpUrl(config.otlpEndpoint, '/v1/metrics'),
        headers: config.otlpHeaders,
      })
    : undefined;

  const metricReader = metricExporter
    ? new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: config.metricIntervalMillis,
      })
    : undefined;

  type NodeMetricReader = NonNullable<ConstructorParameters<typeof NodeSDK>[0]>['metricReader'];

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: metricReader as NodeMetricReader,
    instrumentations,
  });

  await sdk.start();
  telemetryEnabled = true;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } finally {
    sdk = null;
    telemetryEnabled = false;
  }
}

export function isTelemetryEnabled(): boolean {
  return telemetryEnabled;
}

export function parseOtlpHeaders(value?: string | null): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((headers, pair) => {
      const [key, ...rest] = pair.split('=');
      if (!key || rest.length === 0) {
        return headers;
      }
      headers[key.trim()] = rest.join('=').trim();
      return headers;
    }, {});
}