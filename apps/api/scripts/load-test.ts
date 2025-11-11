#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

interface LoadOptions {
  baseUrl: string;
  bearer?: string;
  tenantId?: string;
  iterations: number;
  concurrency: number;
  persona: string;
  prompt: string;
}

interface Result {
  durationMs: number;
  status: number;
  ok: boolean;
}

function parseArgs(argv: string[]): LoadOptions {
  const options: LoadOptions = {
    baseUrl: '',
    iterations: 50,
    concurrency: 5,
    persona: 'ceo',
    prompt: 'Telemetry load test prompt',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case '--base-url':
        options.baseUrl = argv[i + 1] ?? '';
        i += 1;
        break;
      case '--bearer':
        options.bearer = argv[i + 1];
        i += 1;
        break;
      case '--tenant-id':
        options.tenantId = argv[i + 1];
        i += 1;
        break;
      case '--iterations':
        options.iterations = Number(argv[i + 1] ?? options.iterations);
        i += 1;
        break;
      case '--concurrency':
        options.concurrency = Number(argv[i + 1] ?? options.concurrency);
        i += 1;
        break;
      case '--persona':
        options.persona = argv[i + 1] ?? options.persona;
        i += 1;
        break;
      case '--prompt':
        options.prompt = argv[i + 1] ?? options.prompt;
        i += 1;
        break;
      default:
        break;
    }
  }

  if (!options.baseUrl) {
    options.baseUrl = process.env.LOAD_BASE_URL ?? '';
  }

  if (!options.baseUrl) {
    console.error('Missing required --base-url or LOAD_BASE_URL environment variable.');
    process.exit(1);
  }

  if (!options.bearer) {
    console.warn('No bearer token supplied. Requests to protected routes will fail unless the environment allows anonymous access.');
  }

  return options;
}

async function executeChat(opts: LoadOptions): Promise<Result> {
  const url = new URL(`/c-suite/${opts.persona}/chat`, opts.baseUrl);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };

  if (opts.bearer) {
    headers.authorization = `Bearer ${opts.bearer}`;
  }

  if (opts.tenantId) {
    headers['x-tenant-id'] = opts.tenantId;
  }

  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: `${opts.prompt} :: ${started}`,
      personaType: opts.persona,
    }),
  });

  // Consume stream to ensure request completes
  try {
    await response.text();
  } catch {
    // ignore stream read errors; metrics are based on status
  }

  const durationMs = performance.now() - started;

  return {
    durationMs,
    status: response.status,
    ok: response.ok,
  };
}

async function runLoadTest(opts: LoadOptions): Promise<void> {
  const results: Result[] = [];
  const queue: Promise<void>[] = [];
  let index = 0;

  const runNext = async (): Promise<void> => {
    if (index >= opts.iterations) {
      return;
    }

    const current = index;
    index += 1;

    try {
      const result = await executeChat(opts);
      results[current] = result;
      const statusLabel = result.ok ? '✔' : '✖';
      console.log(`${statusLabel} #${current + 1} ${result.status} (${result.durationMs.toFixed(0)}ms)`);
    } catch (error) {
      console.error(`✖ #${current + 1} failed`, error);
      results[current] = {
        durationMs: Number.NaN,
        status: 0,
        ok: false,
      };
    }

    await runNext();
  };

  for (let i = 0; i < opts.concurrency; i += 1) {
    queue.push(runNext());
  }

  await Promise.all(queue);

  const success = results.filter((r) => r?.ok);
  const failure = results.filter((r) => r && !r.ok);
  const durations = success.map((r) => r.durationMs).filter((d) => Number.isFinite(d));

  const average = durations.length > 0
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : Number.NaN;

  const p95 = computePercentile(durations, 0.95);
  const p99 = computePercentile(durations, 0.99);

  console.log('\nLoad test summary');
  console.log(`Total iterations: ${results.length}`);
  console.log(`Success: ${success.length}`);
  console.log(`Failures: ${failure.length}`);
  console.log(`Average duration: ${formatMs(average)}`);
  console.log(`p95 duration: ${formatMs(p95)}`);
  console.log(`p99 duration: ${formatMs(p99)}`);
}

function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(percentile * (sorted.length - 1)));
  return sorted[index] ?? Number.NaN;
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  return `${value.toFixed(0)}ms`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Starting load test: ${options.iterations} iterations @ concurrency ${options.concurrency}`);

  await runLoadTest(options);

  console.log('\nReview dashboards for latency/error spikes during this window to tune alert thresholds.');
}

main().catch((error) => {
  console.error('Load test execution failed', error);
  process.exit(1);
});
