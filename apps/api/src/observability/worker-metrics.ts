import type { Worker } from 'bullmq';
import { metrics } from '@opentelemetry/api';
import { isTelemetryEnabled } from './telemetry.js';

const instrumentedWorkers = new WeakSet<Worker>();

const meter = metrics.getMeter('ocsuite.worker');
const jobDuration = meter.createHistogram('ocsuite.queue.job.duration', {
  description: 'Duration of completed jobs',
  unit: 'ms',
});
const jobSuccess = meter.createCounter('ocsuite.queue.job.success', {
  description: 'Count of successful jobs',
});
const jobFailure = meter.createCounter('ocsuite.queue.job.failure', {
  description: 'Count of failed jobs',
});

function resolveAttributes(worker: Worker, jobData: Record<string, unknown>): Record<string, string> {
  const attributes: Record<string, string> = {
    queue: worker.name ?? 'unknown',
  };

  const tenantId = jobData?.tenantId;
  if (typeof tenantId === 'string' && tenantId.length > 0) {
    attributes.tenantId = tenantId;
  }

  const jobType = jobData?.type;
  if (typeof jobType === 'string' && jobType.length > 0) {
    attributes.jobType = jobType;
  }

  return attributes;
}

export function instrumentWorker<T extends Worker>(worker: T): T {
  if (!isTelemetryEnabled() || instrumentedWorkers.has(worker)) {
    return worker;
  }

  worker.on('completed', (job) => {
    try {
      const data = (job.data as Record<string, unknown>) ?? {};
      const attributes = resolveAttributes(worker, data);
      const finished = job.finishedOn ?? Date.now();
      const started = job.processedOn ?? finished;
      const duration = Math.max(finished - started, 0);

      jobDuration.record(duration, attributes);
      jobSuccess.add(1, attributes);
    } catch {
      // ignore instrumentation errors
    }
  });

  worker.on('failed', (job) => {
    try {
      const data = (job?.data as Record<string, unknown>) ?? {};
      const attributes = resolveAttributes(worker, data);
      jobFailure.add(1, attributes);
    } catch {
      // ignore instrumentation errors
    }
  });

  instrumentedWorkers.add(worker);
  return worker;
}