import { PostHog } from 'posthog-node';
import { config } from '../config/index.js';
import { createContextLogger } from './logger.js';

const telemetryLogger = createContextLogger('telemetry');

let client: PostHog | null = null;

if (config.posthog.apiKey) {
  client = new PostHog(config.posthog.apiKey, {
    host: config.posthog.host ?? 'https://app.posthog.com',
    flushAt: 1,
    flushInterval: 5000,
  });
  telemetryLogger.info('Telemetry client initialised with PostHog');
} else {
  telemetryLogger.warn('Telemetry disabled: POSTHOG_API_KEY not configured');
}

export interface TrackTenantEventParams {
  tenantId: string;
  event: string;
  distinctId?: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}

export function isTelemetryEnabled(): boolean {
  return Boolean(client);
}

export async function trackTenantEvent(params: TrackTenantEventParams): Promise<boolean> {
  if (!client) {
    return false;
  }

  if (config.telemetry.disabledTenants.includes(params.tenantId)) {
    telemetryLogger.debug('Telemetry suppressed for tenant', {
      tenantId: params.tenantId,
      event: params.event,
    });
    return false;
  }

  try {
    client.capture({
      distinctId: params.distinctId ?? `tenant:${params.tenantId}`,
      event: params.event,
      timestamp: params.timestamp,
      properties: {
        tenantId: params.tenantId,
        ...params.properties,
      },
    });
    return true;
  } catch (error) {
    telemetryLogger.error('Failed to dispatch telemetry event', {
      tenantId: params.tenantId,
      event: params.event,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

export async function flushTelemetry(): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.flush();
  } catch (error) {
    telemetryLogger.error('Telemetry flush failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

if (client) {
  let shutdownInitiated = false;

  const handleShutdown = async () => {
    if (shutdownInitiated) {
      return;
    }
    shutdownInitiated = true;
    try {
      await flushTelemetry();
    } catch (error) {
      telemetryLogger.warn('Telemetry flush during shutdown encountered an error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      client?.shutdown?.();
    }
  };

  process.once('beforeExit', () => {
    handleShutdown().catch(() => undefined);
  });

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.once(signal, () => {
      handleShutdown().catch(() => undefined);
    });
  }
}
