import { Worker, Job } from 'bullmq';
import { createTenantClient } from '@ocsuite/db';
import {
  QUEUE_NAMES,
  SyncAnalyticsJobData,
  DLQJobData,
  getRedisConnection,
  syncAnalyticsDLQ,
} from '../queue/index.js';
import { config } from '../config/index.js';
import { workerLogger, createContextLogger } from '../utils/logger.js';
import { instrumentWorker } from '../observability/worker-metrics.js';
import { GoogleAnalyticsClient } from '../services/connectors/google-analytics-client.js';

/**
 * Progress tracking interface
 */
interface SyncProgress {
  phase: 'initializing' | 'fetching' | 'processing' | 'storing' | 'completed';
  percentage: number;
  message: string;
  dataPoints?: number;
}

/**
 * Sync result interface
 */
interface SyncResult {
  success: boolean;
  dataPoints: number;
  dateRange: { start: string; end: string };
  duration: number;
}

function toIsoDate(date: Date): string {
  const isoString = date.toISOString();
  const separatorIndex = isoString.indexOf('T');
  return separatorIndex >= 0 ? isoString.slice(0, separatorIndex) : isoString;
}

/**
 * Process sync analytics job
 *
 * Fetches Google Analytics data and stores it in AnalyticsSnapshot table
 */
const processSyncAnalytics = async (
  job: Job<SyncAnalyticsJobData>
): Promise<SyncResult> => {
  const { tenantId, connectorId, dateRange, triggeredBy } = job.data;
  const startTime = Date.now();

  const logger = createContextLogger('sync-analytics-worker', {
    jobId: job.id,
    tenantId,
    connectorId,
  });

  logger.info('Starting analytics sync', {
    triggeredBy,
    dateRange,
    attemptsMade: job.attemptsMade,
  });

  try {
    // Phase 1: Initialize
    await job.updateProgress({
      phase: 'initializing',
      percentage: 10,
      message: 'Initializing analytics sync',
    } as SyncProgress);

    // Initialize Google Analytics client
    const client = await GoogleAnalyticsClient.fromConnector(tenantId, connectorId);

    await job.updateProgress({
      phase: 'initializing',
      percentage: 30,
      message: 'Google Analytics client initialized',
    } as SyncProgress);

    // Determine date range (default: last 30 days)
    const requestedEndDate = dateRange?.end;
    const requestedStartDate = dateRange?.start;

    let endDate: string;
    if (typeof requestedEndDate === 'string' && requestedEndDate.trim().length > 0) {
      endDate = requestedEndDate;
    } else {
  endDate = toIsoDate(new Date());
    }

    let startDate: string;
    if (typeof requestedStartDate === 'string' && requestedStartDate.trim().length > 0) {
      startDate = requestedStartDate;
    } else {
  startDate = toIsoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    }

    logger.info('Fetching analytics data', { startDate, endDate });

    // Phase 2: Fetching data
    await job.updateProgress({
      phase: 'fetching',
      percentage: 40,
      message: `Fetching analytics data from ${startDate} to ${endDate}`,
    } as SyncProgress);

    const analyticsData = await client.fetchAnalytics(startDate, endDate);

    logger.info('Fetched analytics data', { dataPoints: analyticsData.length });

    await job.updateProgress({
      phase: 'processing',
      percentage: 60,
      message: `Processing ${analyticsData.length} data points`,
      dataPoints: analyticsData.length,
    } as SyncProgress);

    // Phase 3: Storing data
    await job.updateProgress({
      phase: 'storing',
      percentage: 75,
      message: 'Storing analytics snapshots',
    } as SyncProgress);

    const prisma = createTenantClient({ tenantId });

    try {
      // Store each day's analytics data
      for (const dayData of analyticsData) {
        await prisma.analyticsSnapshot.upsert({
          where: {
            tenantId_date: {
              tenantId,
              date: new Date(dayData.date),
            },
          },
          create: {
            tenantId,
            connectorId,
            date: new Date(dayData.date),
            sessions: dayData.sessions,
            users: dayData.users,
            conversions: dayData.conversions,
            revenue: dayData.revenue,
            sourceBreakdown: dayData.sourceBreakdown,
          },
          update: {
            sessions: dayData.sessions,
            users: dayData.users,
            conversions: dayData.conversions,
            revenue: dayData.revenue,
            sourceBreakdown: dayData.sourceBreakdown,
            connectorId,
          },
        });
      }

      await job.updateProgress({
        phase: 'storing',
        percentage: 90,
        message: 'Updating connector status',
      } as SyncProgress);

      // Update connector status
      await prisma.connector.update({
        where: { id: connectorId },
        data: {
          status: 'active',
          lastSyncedAt: new Date(),
          metadata: {
            lastSyncDataPoints: analyticsData.length,
            lastSyncDateRange: { start: startDate, end: endDate },
          },
        },
      });

      await job.updateProgress({
        phase: 'completed',
        percentage: 100,
        message: 'Analytics sync completed successfully',
      } as SyncProgress);

      const duration = Date.now() - startTime;

      logger.info('Analytics sync completed', {
        dataPoints: analyticsData.length,
        dateRange: { start: startDate, end: endDate },
        duration,
      });

      return {
        success: true,
        dataPoints: analyticsData.length,
        dateRange: { start: startDate, end: endDate },
        duration,
      };
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Analytics sync failed', {
      error: errorMessage,
      duration,
      attemptsMade: job.attemptsMade,
    });

    // Update connector status to error if this is the last attempt
    if (job.attemptsMade >= config.queueMaxRetries) {
      try {
        const prisma = createTenantClient({ tenantId });
        await prisma.connector.update({
          where: { id: connectorId },
          data: {
            status: 'error',
            metadata: {
              lastError: errorMessage,
              lastErrorAt: new Date().toISOString(),
            },
          },
        });
        await prisma.$disconnect();
      } catch (updateError) {
        logger.error('Failed to update connector status', {
          error: updateError instanceof Error ? updateError.message : 'Unknown error',
        });
      }
    }

    throw error;
  }
};

/**
 * Handle job failure and move to DLQ
 */
const handleJobFailure = async (
  job: Job<SyncAnalyticsJobData>,
  error: Error
): Promise<void> => {
  const logger = createContextLogger('sync-analytics-dlq', {
    jobId: job.id,
    tenantId: job.data.tenantId,
  });

  logger.error('Moving job to DLQ', {
    error: error.message,
    attemptsMade: job.attemptsMade,
  });

  const dlqData: DLQJobData = {
    originalQueue: QUEUE_NAMES.SYNC_ANALYTICS,
    originalJobId: job.id!,
    tenantId: job.data.tenantId,
    failedData: job.data,
    failureReason: error.message,
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
  };

  try {
    await syncAnalyticsDLQ.add('sync-analytics-failed', dlqData, {
      removeOnComplete: false,
      removeOnFail: false,
    });

    logger.info('Job moved to DLQ successfully');
  } catch (dlqError) {
    logger.error('Failed to move job to DLQ', {
      error: dlqError instanceof Error ? dlqError.message : 'Unknown error',
    });
  }
};

/**
 * Create and start the sync analytics worker
 */
export const createSyncAnalyticsWorker = (): Worker<SyncAnalyticsJobData> => {
  const worker = new Worker<SyncAnalyticsJobData>(
    QUEUE_NAMES.SYNC_ANALYTICS,
    processSyncAnalytics,
    {
      connection: getRedisConnection(),
      concurrency: 3,
      removeOnComplete: { count: config.queueRemoveOnComplete },
      removeOnFail: { count: config.queueRemoveOnFail },
    }
  );

  // Event listeners
  worker.on('completed', (job, result: SyncResult) => {
    workerLogger.info('Analytics sync job completed', {
      jobId: job.id,
      tenantId: job.data.tenantId,
      connectorId: job.data.connectorId,
      dataPoints: result.dataPoints,
      dateRange: result.dateRange,
      duration: result.duration,
    });
  });

  worker.on('failed', async (job, error) => {
    if (job) {
      workerLogger.error('Analytics sync job failed', {
        jobId: job.id,
        tenantId: job.data.tenantId,
        connectorId: job.data.connectorId,
        error: error.message,
        attemptsMade: job.attemptsMade,
      });

      // Move to DLQ if max retries reached
      if (job.attemptsMade >= config.queueMaxRetries) {
        await handleJobFailure(job, error);
      }
    }
  });

  worker.on('error', (error) => {
    workerLogger.error('Analytics sync worker error', {
      error: error.message,
    });
  });

  worker.on('stalled', (jobId) => {
    workerLogger.warn('Analytics sync job stalled', { jobId });
  });

  workerLogger.info('Analytics sync worker created', {
    concurrency: 3,
  });

  return instrumentWorker(worker);
};
