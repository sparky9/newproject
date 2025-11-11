import { Worker, Job } from 'bullmq';
import { getRedisConnection, KnowledgeRetentionJobData, QUEUE_NAMES } from '../queue/index.js';
import { workerLogger } from '../utils/logger.js';
import { prisma } from '@ocsuite/db';
import { KnowledgeRetentionService } from '../services/knowledge-retention.js';
import { instrumentWorker } from '../observability/worker-metrics.js';

const DEFAULT_REPEAT_EVERY = 60 * 60 * 1000; // 1 hour

export const createKnowledgeRetentionWorker = (): Worker<KnowledgeRetentionJobData> => {
  const retentionService = new KnowledgeRetentionService({
    prisma,
    batchSize: 200,
  });

  return instrumentWorker(
    new Worker<KnowledgeRetentionJobData>(
      QUEUE_NAMES.KNOWLEDGE_RETENTION,
      async (job: Job<KnowledgeRetentionJobData>) => {
      const { tenantId, limit, dryRun } = job.data;

      workerLogger.info('Starting knowledge retention sweep', {
        jobId: job.id,
        tenantId: tenantId ?? 'all-tenants',
        limit,
        dryRun: !!dryRun,
      });

      const result = await retentionService.purgeExpiredEntries({ tenantId, limit, dryRun });

      workerLogger.info('Knowledge retention sweep completed', {
        jobId: job.id,
        tenantId: tenantId ?? 'all-tenants',
        ...result,
      });

      return result;
      },
      {
        connection: getRedisConnection(),
        concurrency: 1,
      }
    ),
  );
};

export const startKnowledgeRetentionWorker = (): Worker<KnowledgeRetentionJobData> => {
  const worker = createKnowledgeRetentionWorker();

  worker.on('completed', (job, result) => {
    workerLogger.info('Knowledge retention job completed', {
      jobId: job.id,
      result,
    });
  });

  worker.on('failed', (job, err) => {
    workerLogger.error('Knowledge retention job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
};

export const enqueueKnowledgeRetentionSweep = async (
  queue: import('bullmq').Queue<KnowledgeRetentionJobData>,
  data: KnowledgeRetentionJobData,
  options: import('bullmq').JobsOptions = {}
) => {
  const job = await queue.add('knowledge-retention', data, options);
  workerLogger.info('Enqueued knowledge retention sweep', {
    jobId: job.id,
    tenantId: data.tenantId ?? 'all-tenants',
    options,
  });
  return job;
};

export const defaultKnowledgeRetentionRepeat = {
  every: DEFAULT_REPEAT_EVERY,
  tz: 'UTC',
};
