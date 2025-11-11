#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

interface CliOptions {
  baseUrl: string;
  bearer?: string;
  tenantId?: string;
  chatPrompt?: string;
  persona?: string;
  pauseMs: number;
  headers: Record<string, string>;
}

type HttpMethod = 'GET' | 'POST';

interface SmokeCheck {
  name: string;
  method: HttpMethod;
  path: string;
  body?: unknown;
  skip?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: '',
    pauseMs: 500,
    headers: {},
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
      case '--chat-prompt':
        options.chatPrompt = argv[i + 1];
        i += 1;
        break;
      case '--persona':
        options.persona = argv[i + 1];
        i += 1;
        break;
      case '--pause-ms':
        options.pauseMs = Number(argv[i + 1] ?? options.pauseMs);
        i += 1;
        break;
      case '--header': {
        const header = argv[i + 1];

        if (header) {
          const [key, ...rest] = header.split(':');
          const value = rest.join(':').trim();
          if (key) {
            options.headers[key.trim()] = value;
          }
        }

        i += 1;
        break;
      }
      default:
        break;
    }
  }

  if (!options.baseUrl) {
    options.baseUrl = process.env.SMOKE_BASE_URL ?? '';
  }

  if (!options.baseUrl) {
    console.error('Missing required --base-url or SMOKE_BASE_URL environment variable.');
    process.exit(1);
  }

  return options;
}

function buildChecks(opts: CliOptions): SmokeCheck[] {
  const checks: SmokeCheck[] = [
    {
      name: 'health',
      method: 'GET',
      path: '/health',
    },
  ];

  if (opts.chatPrompt && opts.bearer) {
    const persona = opts.persona ?? 'ceo';
    checks.push({
      name: 'chat',
      method: 'POST',
      path: `/c-suite/${persona}/chat`,
      body: {
        message: opts.chatPrompt,
        personaType: persona,
      },
    });
  }

  return checks;
}

async function runCheck(opts: CliOptions, check: SmokeCheck): Promise<void> {
  const url = new URL(check.path, opts.baseUrl);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...opts.headers,
  };

  if (opts.bearer) {
    headers.authorization = `Bearer ${opts.bearer}`;
  }

  if (opts.tenantId) {
    headers['x-tenant-id'] = opts.tenantId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: check.method,
      headers,
      body: check.body ? JSON.stringify(check.body) : undefined,
      signal: controller.signal,
    });

    const durationMs = performance.now() - started;

    if (!response.ok) {
      const text = await response.text();
      console.error(`✖ ${check.name} ${response.status} (${durationMs.toFixed(0)}ms)\n${text}`);
      process.exitCode = 1;
      return;
    }

    console.log(`✔ ${check.name} ${response.status} (${durationMs.toFixed(0)}ms)`);
  } catch (error) {
    console.error(`✖ ${check.name} failed`, error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const checks = buildChecks(options);

  console.log(`Running telemetry smoke checks against ${options.baseUrl}`);

  for (const check of checks) {
    await runCheck(options, check);
    await delay(options.pauseMs);
  }

  if (process.exitCode === 0 || process.exitCode === undefined) {
    console.log('Telemetry smoke run complete. Verify traces/metrics in your APM.');
  } else {
    console.error('One or more checks failed. Investigate before proceeding.');
  }
}

main().catch((error) => {
  console.error('Unexpected error during telemetry smoke run', error);
  process.exit(1);
});
