import type { Queue } from 'bullmq';
import { metrics, type ObservableResult } from '@opentelemetry/api';
import { isTelemetryEnabled } from './telemetry.js';

let registered = false;

export function registerQueueMetrics(queueMap: Record<string, Queue>): void {
  if (!isTelemetryEnabled() || registered) {
    return;
  }

  const meter = metrics.getMeter('ocsuite.queue');

  const waitingGauge = meter.createObservableGauge(
    'ocsuite.queue.jobs.waiting',
    {
      description: 'Number of jobs waiting in the queue',
      unit: '1',
    },
  );

  waitingGauge.addCallback(async (observable: ObservableResult) => {
      for (const [name, queue] of Object.entries(queueMap)) {
        try {
          const waiting = await queue.getWaitingCount();
          observable.observe(waiting, { queue: name });
        } catch {
          // ignore to avoid breaking metric collection
        }
      }
    });

  const activeGauge = meter.createObservableGauge(
    'ocsuite.queue.jobs.active',
    {
      description: 'Number of active jobs being processed',
      unit: '1',
    },
  );

  activeGauge.addCallback(async (observable: ObservableResult) => {
      for (const [name, queue] of Object.entries(queueMap)) {
        try {
          const active = await queue.getActiveCount();
          observable.observe(active, { queue: name });
        } catch {
          // ignore
        }
      }
    });

  const delayedGauge = meter.createObservableGauge(
    'ocsuite.queue.jobs.delayed',
    {
      description: 'Number of delayed jobs',
      unit: '1',
    },
  );

  delayedGauge.addCallback(async (observable: ObservableResult) => {
      for (const [name, queue] of Object.entries(queueMap)) {
        try {
          const delayed = await queue.getDelayedCount();
          observable.observe(delayed, { queue: name });
        } catch {
          // ignore
        }
      }
    });

  const failedGauge = meter.createObservableGauge(
    'ocsuite.queue.jobs.failed',
    {
      description: 'Number of failed jobs retained in the queue',
      unit: '1',
    },
  );

  failedGauge.addCallback(async (observable: ObservableResult) => {
      for (const [name, queue] of Object.entries(queueMap)) {
        try {
          const failed = await queue.getFailedCount();
          observable.observe(failed, { queue: name });
        } catch {
          // ignore
        }
      }
    });

  registered = true;
}