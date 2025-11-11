import { Worker, Job } from 'bullmq';
import { getRedisConnection, AlertJobData } from '../queue/index.js';
import { workerLogger } from '../utils/logger.js';
import { instrumentWorker } from '../observability/worker-metrics.js';

/**
 * Alerts Worker
 *
 * Handles alert delivery for module insights, task failures, and connector errors.
 * Currently a stub - full implementation planned for Phase 3.
 */
export const createAlertsWorker = (): Worker<AlertJobData> => {
  const worker = new Worker<AlertJobData>(
    'alerts',
    async (job: Job<AlertJobData>) => {
      const { tenantId, type, severity, summary } = job.data;

      workerLogger.info('Processing alert', {
        jobId: job.id,
        tenantId,
        type,
        severity,
      });

      // TODO Phase 3: Implement alert delivery mechanisms
      // - Email notifications
      // - In-app notifications
      // - Webhooks
      // - Slack/Teams integrations

      // For now, just log the alert
      workerLogger.warn({ alert: job.data }, 'Alert generated (delivery not implemented)');

      return {
        delivered: false,
        reason: 'Alert delivery pending Phase 3 implementation',
        alert: {
          tenantId,
          type,
          severity,
          summary,
        },
      };
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    }
  );

  return instrumentWorker(worker);
};

// Event listeners
let worker: Worker<AlertJobData> | null = null;

export const startAlertsWorker = (): Worker<AlertJobData> => {
  if (worker) {
    return worker;
  }

  worker = createAlertsWorker();

  worker.on('completed', (job) => {
    workerLogger.info('Alert processed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    workerLogger.error('Alert processing failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
};
