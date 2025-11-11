import { Worker, Job, type JobsOptions } from 'bullmq';
import {
  getRedisConnection,
  triggerRunnerQueue,
  QUEUE_NAMES,
  type TriggerRunnerJobData,
} from '../queue/index.js';
import { workerLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { prisma, withTenantContext } from '@ocsuite/db';
import { evaluateTenantTriggers } from '../services/trigger-engine.js';
import { instrumentWorker } from '../observability/worker-metrics.js';

const TRIGGER_RUNNER_JOB_NAME = 'trigger-runner';
const TRIGGER_RUNNER_REPEAT_ID = 'trigger-runner-recurring';

interface TriggerRunResult {
  runId: string;
  triggered: number;
  tenants: Array<{ tenantId: string; triggered: number }>;
  durationMs: number;
}

async function resolveTenants(job: Job<TriggerRunnerJobData>): Promise<string[]> {
  if (job.data.tenantId) {
    return [job.data.tenantId];
  }

  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  return tenants.map((tenant) => tenant.id);
}

async function processTriggerJob(job: Job<TriggerRunnerJobData>): Promise<TriggerRunResult> {
  const { triggeredBy, runId: requestedRunId } = job.data;
  const runId = requestedRunId ?? job.id ?? `trigger-runner-${Date.now()}`;
  const startedAt = Date.now();
  const now = new Date();

  workerLogger.info('Starting trigger evaluation job', {
    jobId: job.id,
    runId,
    triggeredBy,
    tenantId: job.data.tenantId ?? 'all-tenants',
  });

  const tenants = await resolveTenants(job);
  if (!tenants.length) {
    workerLogger.warn('No tenants available for trigger evaluation run', {
      jobId: job.id,
    });
    return {
      runId,
      triggered: 0,
      tenants: [],
      durationMs: Date.now() - startedAt,
    };
  }

  let triggeredTotal = 0;
  const perTenant: Array<{ tenantId: string; triggered: number }> = [];

  for (const tenantId of tenants) {
    try {
      const triggered = await withTenantContext(prisma, tenantId, async (tx) => {
        return evaluateTenantTriggers(tx, {
          tenantId,
          now,
        });
      });

      perTenant.push({ tenantId, triggered });
      triggeredTotal += triggered;

      workerLogger.debug('Completed trigger evaluation for tenant', {
        tenantId,
        triggered,
        runId,
      });
    } catch (error) {
      workerLogger.error('Trigger evaluation failed for tenant', {
        tenantId,
        runId,
        jobId: job.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const durationMs = Date.now() - startedAt;

  workerLogger.info('Trigger evaluation job completed', {
    runId,
    jobId: job.id,
    triggeredTotal,
    evaluatedTenants: perTenant.length,
    durationMs,
  });

  return {
    runId,
    triggered: triggeredTotal,
    tenants: perTenant,
    durationMs,
  };
}

export const createTriggerRunnerWorker = (): Worker<TriggerRunnerJobData> => {
  const worker = instrumentWorker(
    new Worker<TriggerRunnerJobData>(
    QUEUE_NAMES.TRIGGER_RUNNER,
    async (job) => processTriggerJob(job),
    {
      connection: getRedisConnection(),
      concurrency: config.queueTriggerRunnerConcurrency,
    }
    )
  );

  worker.on('failed', (job, error) => {
    workerLogger.error('Trigger runner job failed', {
      jobId: job?.id,
      tenantId: job?.data?.tenantId ?? 'all-tenants',
      error: error?.message,
    });
  });

  worker.on('completed', (job) => {
    workerLogger.debug('Trigger runner job completed', {
      jobId: job.id,
    });
  });

  return worker;
};

export const startTriggerRunnerWorker = (): Worker<TriggerRunnerJobData> => {
  return createTriggerRunnerWorker();
};

export async function ensureTriggerRunnerSchedule(): Promise<void> {
  const cronPattern = config.triggerRunnerCron;
  const repeatables = await triggerRunnerQueue.getRepeatableJobs();
  await Promise.all(
    repeatables
      .filter((job) => job.id === TRIGGER_RUNNER_REPEAT_ID || job.name === TRIGGER_RUNNER_JOB_NAME)
      .map((job) => triggerRunnerQueue.removeRepeatableByKey(job.key))
  );

  await triggerRunnerQueue.add(
    TRIGGER_RUNNER_JOB_NAME,
    {},
    {
      jobId: TRIGGER_RUNNER_REPEAT_ID,
      repeat: {
        pattern: cronPattern,
        tz: 'UTC',
      },
    }
  );

  workerLogger.info('Registered trigger runner cron job', {
    pattern: cronPattern,
  });
}

export async function enqueueTriggerRunnerJob(
  data: TriggerRunnerJobData,
  options: JobsOptions = {}
): Promise<void> {
  await triggerRunnerQueue.add(TRIGGER_RUNNER_JOB_NAME, data, options);
  workerLogger.debug('Enqueued trigger runner job', {
    tenantId: data.tenantId ?? 'all-tenants',
    runId: data.runId,
  });
}
