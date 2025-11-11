#!/usr/bin/env node
/**
 * Worker Process Runner
 *
 * This file starts all BullMQ workers for processing background jobs.
 * It can be run separately from the API server for better scalability.
 *
 * Usage:
 *   npm run dev:workers      (development with auto-reload)
 *   npm run start:workers    (production)
 */

import { Worker } from 'bullmq';
import {
  initializeQueues,
  closeQueues,
  checkQueueHealth,
  knowledgeRetentionQueue,
} from '../queue/index.js';
import { createSyncConnectorWorker } from './sync-connector.worker.js';
import { createExecuteTaskWorker } from './execute-task.worker.js';
import { createSyncAnalyticsWorker } from './sync-analytics.worker.js';
import { startGrowthPulseWorker } from './modules/growth-pulse.worker.js';
import { createBoardMeetingWorker } from './board-meeting.worker.js';
import { createActionExecutorWorker } from './action-executor.worker.js';
import { workerLogger } from '../utils/logger.js';
import { startKnowledgeRetentionWorker, defaultKnowledgeRetentionRepeat } from './knowledge-retention.worker.js';
import { startTriggerRunnerWorker, ensureTriggerRunnerSchedule } from './trigger-runner.worker.js';
import { checkDatabaseHealth } from '@ocsuite/db';
import { config } from '../config/index.js';
import { initializeTelemetry, shutdownTelemetry, parseOtlpHeaders } from '../observability/telemetry.js';

/**
 * Worker Manager
 */
class WorkerManager {
  private workers: Worker[] = [];
  private isShuttingDown = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Start all workers
   */
  async start(): Promise<void> {
    try {
      workerLogger.info('Starting worker process...');

      await initializeTelemetry({
        enabled: config.observability.enabled,
        serviceName: `${config.observability.serviceName}-workers`,
        environment: config.nodeEnv,
        otlpEndpoint: config.observability.otlpEndpoint ?? undefined,
        otlpHeaders: parseOtlpHeaders(config.observability.otlpHeaders),
        metricIntervalMillis: config.observability.metricIntervalMillis,
        logLevel: config.observability.logLevel,
      });

      // Check system health
      await this.checkSystemHealth();

      // Initialize queues
      await initializeQueues();

      // Create and start workers
      workerLogger.info('Creating workers...');

      const syncConnectorWorker = createSyncConnectorWorker();
      const executeTaskWorker = createExecuteTaskWorker();
      const actionExecutorWorker = createActionExecutorWorker();
      const syncAnalyticsWorker = createSyncAnalyticsWorker();
      const boardMeetingWorker = createBoardMeetingWorker();
      const growthPulseWorker = startGrowthPulseWorker();
      const triggerRunnerWorker = startTriggerRunnerWorker();
      const knowledgeRetentionWorker = startKnowledgeRetentionWorker();

      await this.ensureKnowledgeRetentionSchedule();
      await ensureTriggerRunnerSchedule();

      this.workers.push(
        syncConnectorWorker,
        executeTaskWorker,
        actionExecutorWorker,
        syncAnalyticsWorker,
        boardMeetingWorker,
        growthPulseWorker,
        triggerRunnerWorker,
        knowledgeRetentionWorker
      );

      workerLogger.info('All workers started successfully', {
        workerCount: this.workers.length,
        workers: this.workers.map((w) => w.name),
      });

      // Start health check monitoring
      this.startHealthChecks();

      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();

      workerLogger.info('Worker process is ready and waiting for jobs');
    } catch (error) {
      workerLogger.error('Failed to start workers', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      process.exit(1);
    }
  }

  private async ensureKnowledgeRetentionSchedule(): Promise<void> {
    const repeatables = await knowledgeRetentionQueue.getRepeatableJobs();
    const hasRecurring = repeatables.some((job) => job.name === 'knowledge-retention');

    if (!hasRecurring) {
      await knowledgeRetentionQueue.add(
        'knowledge-retention',
        {},
        {
          repeat: defaultKnowledgeRetentionRepeat,
          jobId: 'knowledge-retention-recurring',
        }
      );

      workerLogger.info('Created recurring knowledge retention sweep');
    }
  }

  /**
   * Check system health before starting
   */
  private async checkSystemHealth(): Promise<void> {
    workerLogger.info('Checking system health...');

    // Check database
    const dbHealthy = await checkDatabaseHealth();
    if (!dbHealthy) {
      throw new Error('Database health check failed');
    }
    workerLogger.info('Database is healthy');

    // Check queue health
    const queueHealth = await checkQueueHealth();
    if (!queueHealth.healthy) {
      throw new Error('Queue health check failed');
    }
    workerLogger.info('Queues are healthy', {
      queues: Object.keys(queueHealth.queues),
    });
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getWorkerHealth();

        if (!health.healthy) {
          workerLogger.warn('Health check detected issues', health);
        } else {
          workerLogger.debug('Health check passed', health);
        }
      } catch (error) {
        workerLogger.error('Health check failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  /**
   * Get worker health status
   */
  async getWorkerHealth(): Promise<{
    healthy: boolean;
    workers: Array<{
      name: string;
      running: boolean;
      processing: number;
    }>;
    queues: Record<string, { active: number; waiting: number; failed: number }>;
  }> {
    const queueHealth = await checkQueueHealth();

    const workerStatus = this.workers.map((worker) => {
      const stats = queueHealth.queues[worker.name] ?? {
        active: 0,
        waiting: 0,
        failed: 0,
      };

      return {
        name: worker.name,
        running: true,
        processing: stats.active,
      };
    });

    return {
      healthy: queueHealth.healthy && this.workers.length > 0,
      workers: workerStatus,
      queues: queueHealth.queues,
    };
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdownSignals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

    shutdownSignals.forEach((signal) => {
      process.on(signal, async () => {
        if (this.isShuttingDown) {
          workerLogger.warn('Shutdown already in progress, forcing exit...');
          process.exit(1);
        }

        workerLogger.info(`Received ${signal}, starting graceful shutdown...`);
        await this.shutdown();
      });
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      workerLogger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack,
      });
      this.shutdown().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
      workerLogger.error('Unhandled rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      this.shutdown().then(() => process.exit(1));
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    workerLogger.info('Starting graceful shutdown...');

    try {
      // Stop health checks
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Close all workers (waits for active jobs to complete)
      workerLogger.info('Closing workers...');
      await Promise.all(
        this.workers.map(async (worker) => {
          try {
            await worker.close();
            workerLogger.info(`Worker ${worker.name} closed successfully`);
          } catch (error) {
            workerLogger.error(`Failed to close worker ${worker.name}`, {
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        })
      );

      // Close queues and Redis connection
      workerLogger.info('Closing queues...');
      await closeQueues();

      workerLogger.info('Shutting down telemetry...');
      await shutdownTelemetry();

      workerLogger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      workerLogger.error('Error during shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      process.exit(1);
    }
  }

  /**
   * Pause all workers
   */
  async pause(): Promise<void> {
    workerLogger.info('Pausing all workers...');
    await Promise.all(this.workers.map((worker) => worker.pause()));
    workerLogger.info('All workers paused');
  }

  /**
   * Resume all workers
   */
  async resume(): Promise<void> {
    workerLogger.info('Resuming all workers...');
    await Promise.all(this.workers.map((worker) => worker.resume()));
    workerLogger.info('All workers resumed');
  }
}

/**
 * Start the worker process
 */
const startWorkers = async (): Promise<void> => {
  const manager = new WorkerManager();
  await manager.start();
};

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorkers().catch((error) => {
    console.error('Failed to start workers:', error);
    shutdownTelemetry().catch(() => undefined);
    process.exit(1);
  });
}

export { WorkerManager, startWorkers };
