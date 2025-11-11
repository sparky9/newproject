import { Worker, Job } from 'bullmq';
import { createTenantClient } from '@ocsuite/db';
import {
  QUEUE_NAMES,
  ExecuteTaskJobData,
  DLQJobData,
  getRedisConnection,
  executeTaskDLQ,
} from '../queue/index.js';
import { config } from '../config/index.js';
import { workerLogger, createContextLogger } from '../utils/logger.js';
import { instrumentWorker } from '../observability/worker-metrics.js';
import { incrementJobCompletion, incrementJobFailure } from '../utils/metrics.js';
import { toInputJson } from '../utils/json.js';

/**
 * Progress tracking interface
 */
interface TaskProgress {
  phase: 'initializing' | 'validating' | 'executing' | 'finalizing' | 'completed';
  percentage: number;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Task execution result interface
 */
interface TaskResult {
  success: boolean;
  output: Record<string, unknown>;
  executedAt: string;
  duration: number;
}

/**
 * Process task execution job
 *
 * This is a stub implementation that demonstrates the worker pattern.
 * In production, this would:
 * 1. Fetch the task from database
 * 2. Validate task prerequisites
 * 3. Execute the task logic (AI call, data processing, etc.)
 * 4. Store the result
 * 5. Update task status
 */
const processTaskExecution = async (
  job: Job<ExecuteTaskJobData>
): Promise<TaskResult> => {
  const { tenantId, taskId, userId, payload } = job.data;
  const startTime = Date.now();

  const logger = createContextLogger('execute-task-worker', {
    jobId: job.id,
    tenantId,
    taskId,
    userId,
  });

  logger.info('Starting task execution', {
    taskType: payload.type || 'unknown',
    attemptsMade: job.attemptsMade,
  });

  try {
    // Create tenant-scoped database client
    const db = createTenantClient({ tenantId, userId });

    // Phase 1: Initialize
    await job.updateProgress({
      phase: 'initializing',
      percentage: 0,
      message: 'Initializing task execution',
    } as TaskProgress);

    // Fetch task from database
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found for tenant ${tenantId}`);
    }

    if (task.tenantId !== tenantId) {
      throw new Error(`Task ${taskId} does not belong to tenant ${tenantId}`);
    }

    if (task.status === 'completed') {
      logger.warn('Task already completed', { completedAt: task.executedAt });
      // Return existing result
      return {
        success: true,
        output: task.result as Record<string, unknown> || {},
        executedAt: task.executedAt?.toISOString() || new Date().toISOString(),
        duration: 0,
      };
    }

    // Update task status to running
    await db.task.update({
      where: { id: taskId },
      data: {
        status: 'running',
        error: null,
      },
    });

    logger.info('Task found and marked as running', {
      taskType: task.type,
      priority: task.priority,
      status: task.status,
    });

    // Phase 2: Validating
    await job.updateProgress({
      phase: 'validating',
      percentage: 20,
      message: 'Validating task prerequisites',
    } as TaskProgress);

    // STUB: Validate prerequisites
    // In production:
    // - Check required connectors are active
    // - Validate user permissions
    // - Check resource availability
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Phase 3: Executing
    await job.updateProgress({
      phase: 'executing',
      percentage: 40,
      message: `Executing task: ${task.type}`,
      metadata: {
        taskType: task.type,
        priority: task.priority,
      },
    } as TaskProgress);

    // STUB: Execute task logic based on type
    let taskOutput: Record<string, unknown>;

    switch (task.type) {
      case 'ai-analysis':
        // STUB: Call AI model with context
        await new Promise((resolve) => setTimeout(resolve, 2000));
        taskOutput = {
          analysis: 'This is a mock AI analysis result',
          confidence: 0.95,
          recommendations: [
            'Recommendation 1',
            'Recommendation 2',
            'Recommendation 3',
          ],
        };
        break;

      case 'data-sync':
        // STUB: Sync data from connectors
        await new Promise((resolve) => setTimeout(resolve, 1500));
        taskOutput = {
          itemsSynced: Math.floor(Math.random() * 100) + 1,
          source: 'google-drive',
          lastSyncedAt: new Date().toISOString(),
        };
        break;

      case 'report-generation':
        // STUB: Generate report
        await new Promise((resolve) => setTimeout(resolve, 1000));
        taskOutput = {
          reportId: `report-${Date.now()}`,
          format: 'pdf',
          pages: Math.floor(Math.random() * 50) + 5,
          downloadUrl: `/reports/report-${Date.now()}.pdf`,
        };
        break;

      default:
        // Generic task execution
        await new Promise((resolve) => setTimeout(resolve, 1000));
        taskOutput = {
          processed: true,
          taskType: task.type,
          payload: task.payload,
        };
    }

    // Phase 4: Finalizing
    await job.updateProgress({
      phase: 'finalizing',
      percentage: 80,
      message: 'Storing results',
    } as TaskProgress);

    // Update task with result
    await db.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        result: toInputJson(taskOutput),
        executedAt: new Date(),
        error: null,
      },
    });

    // STUB: Trigger any post-execution hooks
    // In production:
    // - Send notifications
    // - Update related records
    // - Trigger downstream tasks
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Phase 5: Completed
    await job.updateProgress({
      phase: 'completed',
      percentage: 100,
      message: 'Task completed successfully',
    } as TaskProgress);

    const duration = Date.now() - startTime;

    logger.info('Task execution completed', {
      taskType: task.type,
      duration,
      outputKeys: Object.keys(taskOutput),
    });

    // Cleanup database connection
    await db.$disconnect();

    return {
      success: true,
      output: taskOutput,
      executedAt: new Date().toISOString(),
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Task execution failed', {
      error: errorMessage,
      duration,
      attemptsMade: job.attemptsMade,
    });

    // Update task status to failed if this is the last attempt
    if (job.attemptsMade >= config.queueMaxRetries) {
      try {
        const db = createTenantClient({ tenantId, userId });
        await db.task.update({
          where: { id: taskId },
          data: {
            status: 'failed',
            error: errorMessage,
          },
        });
        await db.$disconnect();
      } catch (updateError) {
        logger.error('Failed to update task status', {
          error: updateError instanceof Error ? updateError.message : 'Unknown error',
        });
      }
    } else {
      // Mark as pending for retry
      try {
        const db = createTenantClient({ tenantId, userId });
        await db.task.update({
          where: { id: taskId },
          data: {
            status: 'pending',
            error: `Attempt ${job.attemptsMade} failed: ${errorMessage}`,
          },
        });
        await db.$disconnect();
      } catch (updateError) {
        logger.error('Failed to update task status for retry', {
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
  job: Job<ExecuteTaskJobData>,
  error: Error
): Promise<void> => {
  const logger = createContextLogger('execute-task-dlq', {
    jobId: job.id,
    tenantId: job.data.tenantId,
    taskId: job.data.taskId,
  });

  logger.error('Moving job to DLQ', {
    error: error.message,
    attemptsMade: job.attemptsMade,
  });

  const dlqData: DLQJobData = {
    originalQueue: QUEUE_NAMES.EXECUTE_TASK,
    originalJobId: job.id!,
    tenantId: job.data.tenantId,
    failedData: job.data,
    failureReason: error.message,
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
  };

  try {
    await executeTaskDLQ.add('execute-task-failed', dlqData, {
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
 * Create and start the execute task worker
 */
export const createExecuteTaskWorker = (): Worker<ExecuteTaskJobData> => {
  const worker = new Worker<ExecuteTaskJobData>(
    QUEUE_NAMES.EXECUTE_TASK,
    processTaskExecution,
    {
      connection: getRedisConnection(),
      concurrency: config.queueExecuteTaskConcurrency,
      removeOnComplete: { count: config.queueRemoveOnComplete },
      removeOnFail: { count: config.queueRemoveOnFail },
    }
  );

  // Event listeners
  worker.on('completed', (job, result: TaskResult) => {
    incrementJobCompletion(QUEUE_NAMES.EXECUTE_TASK);
    workerLogger.info('Execute task job completed', {
      jobId: job.id,
      tenantId: job.data.tenantId,
      taskId: job.data.taskId,
      duration: result.duration,
    });
  });

  worker.on('failed', async (job, error) => {
    if (job) {
      incrementJobFailure(QUEUE_NAMES.EXECUTE_TASK);
      workerLogger.error('Execute task job failed', {
        jobId: job.id,
        tenantId: job.data.tenantId,
        taskId: job.data.taskId,
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
    workerLogger.error('Execute task worker error', {
      error: error.message,
    });
  });

  worker.on('stalled', (jobId) => {
    workerLogger.warn('Execute task job stalled', { jobId });
  });

  workerLogger.info('Execute task worker created', {
    concurrency: config.queueExecuteTaskConcurrency,
  });

  return instrumentWorker(worker);
};
