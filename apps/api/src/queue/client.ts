import { Job, JobsOptions } from 'bullmq';
import {
  syncConnectorQueue,
  executeTaskQueue,
  syncAnalyticsQueue,
  boardMeetingQueue,
  actionExecutorQueue,
  knowledgeRetentionQueue,
  SyncConnectorJobData,
  ExecuteTaskJobData,
  SyncAnalyticsJobData,
  BoardMeetingJobData,
  ActionExecutorJobData,
  KnowledgeRetentionJobData,
  QUEUE_NAMES,
} from './index.js';
import { queueLogger } from '../utils/logger.js';

/**
 * Job Options Overrides
 */
export interface EnqueueOptions {
  priority?: number;
  delay?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  jobId?: string; // For deduplication
}

/**
 * Job Result Types
 */
export interface EnqueueResult {
  jobId: string;
  queueName: string;
  enqueuedAt: string;
}

export const enqueueKnowledgeRetention = async (
  data: KnowledgeRetentionJobData,
  options: EnqueueOptions & { jobName?: string } = {}
): Promise<EnqueueResult> => {
  try {
    const {
      priority,
      delay,
      removeOnComplete,
      removeOnFail,
      jobId,
      jobName = 'knowledge-retention',
    } = options;

    const jobOptions: JobsOptions = {
      priority,
      delay,
      removeOnComplete,
      removeOnFail,
      jobId: jobId || `${jobName}-${Date.now()}`,
    };

    const job = await knowledgeRetentionQueue.add(jobName, data, jobOptions);

    queueLogger.info('Enqueued knowledge retention job', {
      jobId: job.id,
      tenantId: data.tenantId ?? 'all-tenants',
      dryRun: !!data.dryRun,
      limit: data.limit,
    });

    return {
      jobId: job.id!,
      queueName: QUEUE_NAMES.KNOWLEDGE_RETENTION,
      enqueuedAt: new Date().toISOString(),
    };
  } catch (error) {
    queueLogger.error('Failed to enqueue knowledge retention job', {
      tenantId: data.tenantId ?? 'all-tenants',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Enqueue a connector sync job
 *
 * @param tenantId - Tenant ID for isolation
 * @param connectorId - Connector to sync
 * @param options - Job options
 * @returns Job information
 */
export const enqueueSyncConnector = async (
  tenantId: string,
  connectorId: string,
  options: EnqueueOptions & { triggeredBy?: string } = {}
): Promise<EnqueueResult> => {
  try {
    const { triggeredBy, priority, delay, removeOnComplete, removeOnFail, jobId } = options;

    const jobData: SyncConnectorJobData = {
      tenantId,
      connectorId,
      triggeredBy,
      priority,
    };

    const jobOptions: JobsOptions = {
      priority,
      delay,
      removeOnComplete,
      removeOnFail,
      jobId: jobId || `sync-${tenantId}-${connectorId}-${Date.now()}`,
    };

    const job = await syncConnectorQueue.add(
      'sync-connector',
      jobData,
      jobOptions
    );

    queueLogger.info('Enqueued sync connector job', {
      jobId: job.id,
      tenantId,
      connectorId,
      triggeredBy,
    });

    return {
      jobId: job.id!,
      queueName: QUEUE_NAMES.SYNC_CONNECTOR,
      enqueuedAt: new Date().toISOString(),
    };
  } catch (error) {
    queueLogger.error('Failed to enqueue sync connector job', {
      tenantId,
      connectorId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Enqueue a task execution job
 *
 * @param tenantId - Tenant ID for isolation
 * @param taskId - Task to execute
 * @param userId - User who triggered the task
 * @param payload - Task payload
 * @param options - Job options
 * @returns Job information
 */
export const enqueueTaskExecution = async (
  tenantId: string,
  taskId: string,
  userId: string,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {}
): Promise<EnqueueResult> => {
  try {
    const { priority, delay, removeOnComplete, removeOnFail, jobId } = options;

    const jobData: ExecuteTaskJobData = {
      tenantId,
      taskId,
      userId,
      payload,
      priority,
    };

    const jobOptions: JobsOptions = {
      priority,
      delay,
      removeOnComplete,
      removeOnFail,
      jobId: jobId || `task-${tenantId}-${taskId}-${Date.now()}`,
    };

    const job = await executeTaskQueue.add(
      'execute-task',
      jobData,
      jobOptions
    );

    queueLogger.info('Enqueued task execution job', {
      jobId: job.id,
      tenantId,
      taskId,
      userId,
    });

    return {
      jobId: job.id!,
      queueName: QUEUE_NAMES.EXECUTE_TASK,
      enqueuedAt: new Date().toISOString(),
    };
  } catch (error) {
    queueLogger.error('Failed to enqueue task execution job', {
      tenantId,
      taskId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Enqueue an action execution job
 *
 * @param jobData - Data describing the action approval to execute
 * @param options - Job options overrides
 * @returns Job information
 */
export const enqueueActionExecution = async (
  jobData: ActionExecutorJobData,
  options: EnqueueOptions = {}
): Promise<EnqueueResult> => {
  const { tenantId, approvalId, source } = jobData;

  try {
    const { priority, delay, removeOnComplete, removeOnFail, jobId } = options;

    const jobOptions: JobsOptions = {
      priority,
      delay,
      removeOnComplete,
      removeOnFail,
      jobId: jobId || `approval-${tenantId}-${approvalId}`,
    };

    const job = await actionExecutorQueue.add(
      'execute-action',
      jobData,
      jobOptions
    );

    queueLogger.info('Enqueued action execution job', {
      jobId: job.id,
      tenantId,
      approvalId,
      source,
    });

    return {
      jobId: job.id!,
      queueName: QUEUE_NAMES.ACTION_EXECUTOR,
      enqueuedAt: new Date().toISOString(),
    };
  } catch (error) {
    queueLogger.error('Failed to enqueue action execution job', {
      tenantId,
      approvalId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Get job status with full details
 *
 * @param queueName - Queue name
 * @param jobId - Job ID
 * @returns Job status information with enhanced details
 */
export const getJobStatus = async (
  queueName: string,
  jobId: string
): Promise<{
  id: string;
  state: string;
  progress: number | object | string;
  data: unknown;
  returnvalue: unknown;
  failedReason?: string;
  attemptsMade: number;
  processedOn?: number;
  finishedOn?: number;
  timestamp: number;
  name?: string;
}> => {
  try {
    let job: Job | undefined;

    if (queueName === QUEUE_NAMES.SYNC_CONNECTOR) {
      job = await syncConnectorQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.EXECUTE_TASK) {
      job = await executeTaskQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.ACTION_EXECUTOR) {
      job = await actionExecutorQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.SYNC_ANALYTICS) {
      job = await syncAnalyticsQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.BOARD_MEETING) {
      job = await boardMeetingQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.KNOWLEDGE_RETENTION) {
      job = await knowledgeRetentionQueue.getJob(jobId);
    }

    if (!job) {
      throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    }

    const state = await job.getState();

    const progress =
      typeof job.progress === 'boolean' ? Number(job.progress) : job.progress;

    return {
      id: job.id!,
      name: job.name,
      state,
      progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      timestamp: Date.now(),
    };
  } catch (error) {
    queueLogger.error('Failed to get job status', {
      queueName,
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Cancel a job
 *
 * @param queueName - Queue name
 * @param jobId - Job ID
 */
export const cancelJob = async (
  queueName: string,
  jobId: string
): Promise<void> => {
  try {
    let job: Job | undefined;

    if (queueName === QUEUE_NAMES.SYNC_CONNECTOR) {
      job = await syncConnectorQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.EXECUTE_TASK) {
      job = await executeTaskQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.ACTION_EXECUTOR) {
      job = await actionExecutorQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.SYNC_ANALYTICS) {
      job = await syncAnalyticsQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.BOARD_MEETING) {
      job = await boardMeetingQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.KNOWLEDGE_RETENTION) {
      job = await knowledgeRetentionQueue.getJob(jobId);
    }

    if (!job) {
      throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    }

    await job.remove();

    queueLogger.info('Cancelled job', {
      queueName,
      jobId,
    });
  } catch (error) {
    queueLogger.error('Failed to cancel job', {
      queueName,
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Retry a failed job
 *
 * @param queueName - Queue name
 * @param jobId - Job ID
 */
export const retryJob = async (
  queueName: string,
  jobId: string
): Promise<void> => {
  try {
    let job: Job | undefined;

    if (queueName === QUEUE_NAMES.SYNC_CONNECTOR) {
      job = await syncConnectorQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.EXECUTE_TASK) {
      job = await executeTaskQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.ACTION_EXECUTOR) {
      job = await actionExecutorQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.SYNC_ANALYTICS) {
      job = await syncAnalyticsQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.BOARD_MEETING) {
      job = await boardMeetingQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.KNOWLEDGE_RETENTION) {
      job = await knowledgeRetentionQueue.getJob(jobId);
    }

    if (!job) {
      throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    }

    await job.retry();

    queueLogger.info('Retrying job', {
      queueName,
      jobId,
    });
  } catch (error) {
    queueLogger.error('Failed to retry job', {
      queueName,
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Bulk enqueue connector syncs
 *
 * @param jobs - Array of sync jobs
 * @returns Array of job information
 */
export const bulkEnqueueSyncConnector = async (
  jobs: Array<{
    tenantId: string;
    connectorId: string;
    triggeredBy?: string;
    options?: EnqueueOptions;
  }>
): Promise<EnqueueResult[]> => {
  try {
    const bulkJobs = jobs.map((job) => ({
      name: 'sync-connector',
      data: {
        tenantId: job.tenantId,
        connectorId: job.connectorId,
        triggeredBy: job.triggeredBy,
        priority: job.options?.priority,
      } as SyncConnectorJobData,
      opts: {
        priority: job.options?.priority,
        delay: job.options?.delay,
        removeOnComplete: job.options?.removeOnComplete,
        removeOnFail: job.options?.removeOnFail,
        jobId: job.options?.jobId || `sync-${job.tenantId}-${job.connectorId}-${Date.now()}`,
      } as JobsOptions,
    }));

    const addedJobs = await syncConnectorQueue.addBulk(bulkJobs);

    queueLogger.info('Bulk enqueued sync connector jobs', {
      count: addedJobs.length,
    });

    return addedJobs.map((job) => ({
      jobId: job.id!,
      queueName: QUEUE_NAMES.SYNC_CONNECTOR,
      enqueuedAt: new Date().toISOString(),
    }));
  } catch (error) {
    queueLogger.error('Failed to bulk enqueue sync connector jobs', {
      count: jobs.length,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Enqueue an analytics sync job
 *
 * @param tenantId - Tenant ID for isolation
 * @param connectorId - Connector to sync
 * @param options - Job options
 * @returns Job information
 */
export const enqueueSyncAnalytics = async (
  tenantId: string,
  connectorId: string,
  options: EnqueueOptions & {
    triggeredBy?: string;
    dateRange?: { start: string; end: string };
  } = {}
): Promise<EnqueueResult> => {
  try {
    const { triggeredBy, dateRange, priority, delay, removeOnComplete, removeOnFail, jobId } = options;

    const jobData: SyncAnalyticsJobData = {
      tenantId,
      connectorId,
      dateRange,
      triggeredBy,
      priority,
    };

    const jobOptions: JobsOptions = {
      priority,
      delay,
      removeOnComplete,
      removeOnFail,
      jobId: jobId || `sync-analytics-${tenantId}-${connectorId}-${Date.now()}`,
    };

    const job = await syncAnalyticsQueue.add(
      'sync-analytics',
      jobData,
      jobOptions
    );

    queueLogger.info('Enqueued analytics sync job', {
      jobId: job.id,
      tenantId,
      connectorId,
      triggeredBy,
      dateRange,
    });

    return {
      jobId: job.id!,
      queueName: QUEUE_NAMES.SYNC_ANALYTICS,
      enqueuedAt: new Date().toISOString(),
    };
  } catch (error) {
    queueLogger.error('Failed to enqueue analytics sync job', {
      tenantId,
      connectorId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Enqueue a board meeting orchestration job
 */
export const enqueueBoardMeeting = async (
  jobData: BoardMeetingJobData,
  options: EnqueueOptions = {}
): Promise<EnqueueResult> => {
  try {
    const { priority, delay, removeOnComplete, removeOnFail, jobId } = options;

    const jobOptions: JobsOptions = {
      priority,
      delay,
      removeOnComplete,
      removeOnFail,
      jobId: jobId || `board-meeting-${jobData.tenantId}-${jobData.meetingId}`,
    };

    const job = await boardMeetingQueue.add('board-meeting', jobData, jobOptions);

    queueLogger.info('Enqueued board meeting job', {
      jobId: job.id,
      tenantId: jobData.tenantId,
      meetingId: jobData.meetingId,
      agendaVersion: jobData.agendaVersion,
    });

    return {
      jobId: job.id!,
      queueName: QUEUE_NAMES.BOARD_MEETING,
      enqueuedAt: new Date().toISOString(),
    };
  } catch (error) {
    queueLogger.error('Failed to enqueue board meeting job', {
      meetingId: jobData.meetingId,
      tenantId: jobData.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Check if a job exists (for deduplication)
 *
 * @param queueName - Queue name
 * @param jobId - Job ID
 * @returns Whether the job exists
 */
export const jobExists = async (
  queueName: string,
  jobId: string
): Promise<boolean> => {
  try {
    let job: Job | undefined;

    if (queueName === QUEUE_NAMES.SYNC_CONNECTOR) {
      job = await syncConnectorQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.EXECUTE_TASK) {
      job = await executeTaskQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.SYNC_ANALYTICS) {
      job = await syncAnalyticsQueue.getJob(jobId);
    } else if (queueName === QUEUE_NAMES.BOARD_MEETING) {
      job = await boardMeetingQueue.getJob(jobId);
    }

    return job !== undefined;
  } catch (error) {
    queueLogger.error('Failed to check job existence', {
      queueName,
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
};
