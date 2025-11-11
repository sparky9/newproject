import { metrics as otelMetrics, type Counter, type Histogram } from '@opentelemetry/api';
import { logger } from './logger.js';
import { isTelemetryEnabled } from '../observability/telemetry.js';

type HttpRequestStats = {
  count: number;
  totalDuration: number;
  lastDuration: number;
};

const state = {
  httpRequests: new Map<string, HttpRequestStats>(),
  llmTokens: { input: 0, output: 0, total: 0 },
  jobCompletions: new Map<string, number>(),
  jobFailures: new Map<string, number>(),
};

const meter = otelMetrics.getMeter('ocsuite.api');

let httpRequestCounter: Counter | null = null;
let httpRequestDuration: Histogram | null = null;
let llmInputCounter: Counter | null = null;
let llmOutputCounter: Counter | null = null;
let llmTotalCounter: Counter | null = null;

function ensureInstruments(): void {
  if (!isTelemetryEnabled()) {
    return;
  }

  if (!httpRequestCounter) {
    httpRequestCounter = meter.createCounter('ocsuite.http.requests', {
      description: 'Count of HTTP requests by route and status',
    });
  }

  if (!httpRequestDuration) {
    httpRequestDuration = meter.createHistogram('ocsuite.http.request.duration', {
      description: 'Duration of HTTP requests in milliseconds',
      unit: 'ms',
    });
  }

  if (!llmInputCounter) {
    llmInputCounter = meter.createCounter('ocsuite.llm.tokens.input', {
      description: 'Input tokens sent to LLM providers',
    });
  }

  if (!llmOutputCounter) {
    llmOutputCounter = meter.createCounter('ocsuite.llm.tokens.output', {
      description: 'Output tokens received from LLM providers',
    });
  }

  if (!llmTotalCounter) {
    llmTotalCounter = meter.createCounter('ocsuite.llm.tokens.total', {
      description: 'Total tokens consumed per request',
    });
  }

}

export function incrementHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationMs?: number,
): void {
  const key = `${method}:${route}:${statusCode}`;
  const entry = state.httpRequests.get(key) ?? { count: 0, totalDuration: 0, lastDuration: 0 };

  entry.count += 1;
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
    entry.totalDuration += durationMs;
    entry.lastDuration = durationMs;
  }

  state.httpRequests.set(key, entry);

  if (isTelemetryEnabled()) {
    ensureInstruments();

    const attributes = {
      method,
      route,
      status: String(statusCode),
    } as const;

    httpRequestCounter?.add(1, attributes);

    if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
      httpRequestDuration?.record(durationMs, attributes);
    }
  }
}

export function trackLLMTokens(
  input: number,
  output: number,
  attributes?: Record<string, string>,
): void {
  state.llmTokens.input += input;
  state.llmTokens.output += output;
  state.llmTokens.total += input + output;

  logger.info({ input, output, total: input + output, attributes }, 'LLM tokens tracked');

  if (isTelemetryEnabled()) {
    ensureInstruments();

    if (input > 0) {
      llmInputCounter?.add(input, attributes);
    }
    if (output > 0) {
      llmOutputCounter?.add(output, attributes);
    }
    if (input + output > 0) {
      llmTotalCounter?.add(input + output, attributes);
    }
  }
}

export function incrementJobCompletion(queueName: string): void {
  state.jobCompletions.set(queueName, (state.jobCompletions.get(queueName) || 0) + 1);
}

export function incrementJobFailure(queueName: string): void {
  state.jobFailures.set(queueName, (state.jobFailures.get(queueName) || 0) + 1);
}

export function getMetrics() {
  const httpEntries = Array.from(state.httpRequests.entries()).map(([key, stats]) => {
    const averageDuration = stats.count > 0 ? stats.totalDuration / stats.count : 0;
    return [
      key,
      {
        count: stats.count,
        averageDurationMs: Number(averageDuration.toFixed(2)),
        lastDurationMs: stats.lastDuration,
      },
    ] as const;
  });

  return {
    http: {
      requests: Object.fromEntries(httpEntries),
      totalRequests: httpEntries.reduce((sum, [, value]) => sum + value.count, 0),
    },
    llm: state.llmTokens,
    jobs: {
      completions: Object.fromEntries(state.jobCompletions),
      failures: Object.fromEntries(state.jobFailures),
      totalCompletions: Array.from(state.jobCompletions.values()).reduce((a, b) => a + b, 0),
      totalFailures: Array.from(state.jobFailures.values()).reduce((a, b) => a + b, 0),
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  } as const;
}

export function resetMetrics(): void {
  state.httpRequests.clear();
  state.llmTokens.input = 0;
  state.llmTokens.output = 0;
  state.llmTokens.total = 0;
  state.jobCompletions.clear();
  state.jobFailures.clear();
}
