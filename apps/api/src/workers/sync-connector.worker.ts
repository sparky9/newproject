import { Worker, Job } from 'bullmq';
import { createTenantClient } from '@ocsuite/db';
import {
  QUEUE_NAMES,
  SyncConnectorJobData,
  DLQJobData,
  getRedisConnection,
  syncConnectorDLQ,
} from '../queue/index.js';
import { config } from '../config/index.js';
import { workerLogger, createContextLogger } from '../utils/logger.js';
import { instrumentWorker } from '../observability/worker-metrics.js';

/**
 * Progress tracking interface
 */
interface SyncProgress {
  phase: 'initializing' | 'fetching' | 'processing' | 'storing' | 'completed';
  percentage: number;
  message: string;
  itemsProcessed?: number;
  itemsTotal?: number;
}

/**
 * Sync result interface
 */
interface SyncResult {
  success: boolean;
  itemsSynced: number;
  errors: string[];
  syncedAt: string;
  duration: number;
}

/**
 * Process sync connector job
 *
 * This is a stub implementation that demonstrates the worker pattern.
 * In production, this would:
 * 1. Fetch the connector from database
 * 2. Decrypt access tokens
 * 3. Call the provider's API
 * 4. Process and store data
 * 5. Update lastSyncedAt
 */
const processSyncConnector = async (
  job: Job<SyncConnectorJobData>
): Promise<SyncResult> => {
  const { tenantId, connectorId, triggeredBy } = job.data;
  const startTime = Date.now();

  const logger = createContextLogger('sync-connector-worker', {
    jobId: job.id,
    tenantId,
    connectorId,
  });

  logger.info('Starting connector sync', {
    triggeredBy,
    attemptsMade: job.attemptsMade,
  });

  try {
    // Create tenant-scoped database client
    const db = createTenantClient({ tenantId });

    // Phase 1: Initialize
    await job.updateProgress({
      phase: 'initializing',
      percentage: 0,
      message: 'Initializing sync process',
    } as SyncProgress);

    // Fetch connector from database
    const connector = await db.connector.findUnique({
      where: {
        id: connectorId,
        tenantId, // Double-check tenant isolation
      },
    });

    if (!connector) {
      throw new Error(`Connector ${connectorId} not found for tenant ${tenantId}`);
    }

    if (connector.status !== 'active') {
      throw new Error(`Connector ${connectorId} is not active (status: ${connector.status})`);
    }

    logger.info('Connector found', {
      provider: connector.provider,
      status: connector.status,
    });

    // Phase 2: Fetching data
    await job.updateProgress({
      phase: 'fetching',
      percentage: 25,
      message: `Fetching data from ${connector.provider}`,
    } as SyncProgress);

    // STUB: In production, decrypt tokens and call provider API
    // const accessToken = await decrypt(connector.encryptedAccessToken);
    // const data = await fetchFromProvider(connector.provider, accessToken);

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const mockItemsToSync = Math.floor(Math.random() * 50) + 10;

    // Phase 3: Processing data
    await job.updateProgress({
      phase: 'processing',
      percentage: 50,
      message: 'Processing fetched data',
      itemsTotal: mockItemsToSync,
      itemsProcessed: 0,
    } as SyncProgress);

    // STUB: Process items in batches
    let itemsProcessed = 0;
    for (let i = 0; i < mockItemsToSync; i += 10) {
      // Simulate processing
      await new Promise((resolve) => setTimeout(resolve, 200));
      itemsProcessed = Math.min(i + 10, mockItemsToSync);

      await job.updateProgress({
        phase: 'processing',
        percentage: 50 + (itemsProcessed / mockItemsToSync) * 25,
        message: `Processing items: ${itemsProcessed}/${mockItemsToSync}`,
        itemsTotal: mockItemsToSync,
        itemsProcessed,
      } as SyncProgress);
    }

    // Phase 4: Storing data
    await job.updateProgress({
      phase: 'storing',
      percentage: 75,
      message: 'Storing processed data',
    } as SyncProgress);

    // STUB: Store data in knowledge base
    // In production:
    // await db.knowledgeEntry.createMany({
    //   data: processedItems.map(item => ({
    //     tenantId,
    //     source: `${connector.provider}:${connectorId}`,
    //     content: item.content,
    //     metadata: item.metadata,
    //   })),
    // });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Update connector lastSyncedAt
    await db.connector.update({
      where: { id: connectorId },
      data: {
        lastSyncedAt: new Date(),
        status: 'active',
      },
    });

    // Phase 5: Completed
    await job.updateProgress({
      phase: 'completed',
      percentage: 100,
      message: 'Sync completed successfully',
    } as SyncProgress);

    const duration = Date.now() - startTime;

    logger.info('Connector sync completed', {
      itemsSynced: mockItemsToSync,
      duration,
    });

    // Cleanup database connection
    await db.$disconnect();

    return {
      success: true,
      itemsSynced: mockItemsToSync,
      errors: [],
      syncedAt: new Date().toISOString(),
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Connector sync failed', {
      error: errorMessage,
      duration,
      attemptsMade: job.attemptsMade,
    });

    // Update connector status to error if this is the last attempt
    if (job.attemptsMade >= config.queueMaxRetries) {
      try {
        const db = createTenantClient({ tenantId });
        await db.connector.update({
          where: { id: connectorId },
          data: {
            status: 'error',
          },
        });
        await db.$disconnect();
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
  job: Job<SyncConnectorJobData>,
  error: Error
): Promise<void> => {
  const logger = createContextLogger('sync-connector-dlq', {
    jobId: job.id,
    tenantId: job.data.tenantId,
  });

  logger.error('Moving job to DLQ', {
    error: error.message,
    attemptsMade: job.attemptsMade,
  });

  const dlqData: DLQJobData = {
    originalQueue: QUEUE_NAMES.SYNC_CONNECTOR,
    originalJobId: job.id!,
    tenantId: job.data.tenantId,
    failedData: job.data,
    failureReason: error.message,
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
  };

  try {
    await syncConnectorDLQ.add('sync-connector-failed', dlqData, {
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
 * Create and start the sync connector worker
 */
export const createSyncConnectorWorker = (): Worker<SyncConnectorJobData> => {
  const worker = new Worker<SyncConnectorJobData>(
    QUEUE_NAMES.SYNC_CONNECTOR,
    processSyncConnector,
    {
      connection: getRedisConnection(),
      concurrency: config.queueSyncConnectorConcurrency,
      removeOnComplete: { count: config.queueRemoveOnComplete },
      removeOnFail: { count: config.queueRemoveOnFail },
    }
  );

  // Event listeners
  worker.on('completed', (job, result: SyncResult) => {
    workerLogger.info('Sync connector job completed', {
      jobId: job.id,
      tenantId: job.data.tenantId,
      connectorId: job.data.connectorId,
      itemsSynced: result.itemsSynced,
      duration: result.duration,
    });
  });

  worker.on('failed', async (job, error) => {
    if (job) {
      workerLogger.error('Sync connector job failed', {
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
    workerLogger.error('Sync connector worker error', {
      error: error.message,
    });
  });

  worker.on('stalled', (jobId) => {
    workerLogger.warn('Sync connector job stalled', { jobId });
  });

  workerLogger.info('Sync connector worker created', {
    concurrency: config.queueSyncConnectorConcurrency,
  });

  return instrumentWorker(worker);
};
