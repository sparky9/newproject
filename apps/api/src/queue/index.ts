import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { queueLogger } from '../utils/logger.js';
import { registerQueueMetrics } from '../observability/queue-metrics.js';

/**
 * Queue Names
 */
export const QUEUE_NAMES = {
  SYNC_CONNECTOR: 'sync-connector',
  EXECUTE_TASK: 'execute-task',
  SYNC_ANALYTICS: 'sync-analytics',
  ALERTS: 'alerts',
  TRIGGER_RUNNER: 'trigger-runner',
  BOARD_MEETING: 'board-meeting',
  ACTION_EXECUTOR: 'action-executor',
  KNOWLEDGE_RETENTION: 'knowledge-retention',
  SYNC_CONNECTOR_DLQ: 'sync-connector-dlq',
  EXECUTE_TASK_DLQ: 'execute-task-dlq',
  SYNC_ANALYTICS_DLQ: 'sync-analytics-dlq',
  ALERTS_DLQ: 'alerts-dlq',
  TRIGGER_RUNNER_DLQ: 'trigger-runner-dlq',
  BOARD_MEETING_DLQ: 'board-meeting-dlq',
  ACTION_EXECUTOR_DLQ: 'action-executor-dlq',
  KNOWLEDGE_RETENTION_DLQ: 'knowledge-retention-dlq',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Job Data Interfaces
 */
export interface SyncConnectorJobData {
  tenantId: string;
  connectorId: string;
  triggeredBy?: string;
  priority?: number;
}

export interface ExecuteTaskJobData {
  tenantId: string;
  taskId: string;
  userId: string;
  payload: Record<string, unknown>;
  priority?: number;
}

export interface SyncAnalyticsJobData {
  tenantId: string;
  connectorId: string;
  dateRange?: {
    start: string;
    end: string;
  };
  triggeredBy?: string;
  priority?: number;
}

export interface BoardMeetingJobData {
  tenantId: string;
  meetingId: string;
  userId: string;
  agenda: {
    id: string;
    title: string;
    personaId: string;
    dependsOn?: string | null;
  }[];
  agendaVersion: number;
  triggeredBy?: string;
}

export interface ActionExecutorJobData {
  tenantId: string;
  approvalId: string;
  source: string;
  payload: Record<string, unknown>;
  createdBy: string;
  approvedBy?: string;
  actionItemId?: string | null;
  moduleSlug?: string;
  capability?: string;
  undoPayload?: Record<string, unknown> | null;
  riskScore?: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeRetentionJobData {
  tenantId?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface AlertJobData {
  tenantId: string;
  type: 'module-insight' | 'task-failure' | 'connector-error';
  severity: 'info' | 'warning' | 'critical';
  moduleSlug?: string;
  insightId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface TriggerRunnerJobData {
  tenantId?: string;
  runId?: string;
  triggeredBy?: string;
}

export interface DLQJobData {
  originalQueue: string;
  originalJobId: string;
  tenantId: string;
  failedData: unknown;
  failureReason: string;
  failedAt: string;
  attemptsMade: number;
}

/**
 * Redis Connection
 */
let redisConnection: IORedis | null = null;

export const getRedisConnection = (): IORedis => {
  if (!redisConnection) {
    redisConnection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      retryStrategy: (times: number) => {
        if (times > config.redisMaxRetries) {
          queueLogger.error('Redis connection failed after max retries', { times });
          return null;
        }
        const delay = Math.min(times * 50, 2000);
        queueLogger.warn(`Redis connection retry attempt ${times}`, { delay });
        return delay;
      },
      reconnectOnError: (err) => {
        queueLogger.error('Redis connection error', { error: err.message });
        return true;
      },
    });

    redisConnection.on('connect', () => {
      queueLogger.info('Redis connected successfully');
    });

    redisConnection.on('error', (error) => {
      queueLogger.error('Redis connection error', { error: error.message });
    });

    redisConnection.on('close', () => {
      queueLogger.warn('Redis connection closed');
    });
  }

  return redisConnection;
};

/**
 * Default Queue Options
 */
const defaultQueueOptions: Omit<QueueOptions, 'connection'> = {
  defaultJobOptions: {
    attempts: config.queueMaxRetries,
    backoff: {
      type: 'exponential',
      delay: config.queueBackoffDelay,
    },
    removeOnComplete: config.queueRemoveOnComplete,
    removeOnFail: config.queueRemoveOnFail,
  },
};

/**
 * Queue Instances
 */
export const syncConnectorQueue = new Queue<SyncConnectorJobData>(
  QUEUE_NAMES.SYNC_CONNECTOR,
  {
    ...defaultQueueOptions,
    connection: getRedisConnection(),
  }
);

export const executeTaskQueue = new Queue<ExecuteTaskJobData>(
  QUEUE_NAMES.EXECUTE_TASK,
  {
    ...defaultQueueOptions,
    connection: getRedisConnection(),
  }
);

export const actionExecutorQueue = new Queue<ActionExecutorJobData>(
  QUEUE_NAMES.ACTION_EXECUTOR,
  {
    ...defaultQueueOptions,
    connection: getRedisConnection(),
  }
);

export const knowledgeRetentionQueue = new Queue<KnowledgeRetentionJobData>(
  QUEUE_NAMES.KNOWLEDGE_RETENTION,
  {
    ...defaultQueueOptions,
    connection: getRedisConnection(),
  }
);

export const syncConnectorDLQ = new Queue<DLQJobData>(
  QUEUE_NAMES.SYNC_CONNECTOR_DLQ,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: false, // Never remove from DLQ
      removeOnFail: false,
    },
  }
);

export const executeTaskDLQ = new Queue<DLQJobData>(
  QUEUE_NAMES.EXECUTE_TASK_DLQ,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: false, // Never remove from DLQ
      removeOnFail: false,
    },
  }
);

export const actionExecutorDLQ = new Queue<DLQJobData>(
  QUEUE_NAMES.ACTION_EXECUTOR_DLQ,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
    },
  }
);

export const knowledgeRetentionDLQ = new Queue<DLQJobData>(
  QUEUE_NAMES.KNOWLEDGE_RETENTION_DLQ,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
    },
  }
);

export const syncAnalyticsQueue = new Queue<SyncAnalyticsJobData>(
  QUEUE_NAMES.SYNC_ANALYTICS,
  {
    ...defaultQueueOptions,
    connection: getRedisConnection(),
  }
);

export const syncAnalyticsDLQ = new Queue<DLQJobData>(
  QUEUE_NAMES.SYNC_ANALYTICS_DLQ,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: false, // Never remove from DLQ
      removeOnFail: false,
    },
  }
);

export const alertsQueue = new Queue<AlertJobData>(
  QUEUE_NAMES.ALERTS,
  {
    ...defaultQueueOptions,
    connection: getRedisConnection(),
  }
);

export const alertsDLQ = new Queue<DLQJobData>(
  QUEUE_NAMES.ALERTS_DLQ,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: false, // Never remove from DLQ
      removeOnFail: false,
    },
  }
);

export const triggerRunnerQueue = new Queue<TriggerRunnerJobData>(
  QUEUE_NAMES.TRIGGER_RUNNER,
  {
    ...defaultQueueOptions,
    connection: getRedisConnection(),
  }
);

export const triggerRunnerDLQ = new Queue<DLQJobData>(
  QUEUE_NAMES.TRIGGER_RUNNER_DLQ,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
    },
  }
);

export const boardMeetingQueue = new Queue<BoardMeetingJobData>(
  QUEUE_NAMES.BOARD_MEETING,
  {
    ...defaultQueueOptions,
    connection: getRedisConnection(),
  }
);

export const boardMeetingDLQ = new Queue<DLQJobData>(
  QUEUE_NAMES.BOARD_MEETING_DLQ,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
    },
  }
);

/**
 * Queue Map for easy access
 */
export const queues = {
  [QUEUE_NAMES.SYNC_CONNECTOR]: syncConnectorQueue,
  [QUEUE_NAMES.EXECUTE_TASK]: executeTaskQueue,
  [QUEUE_NAMES.ACTION_EXECUTOR]: actionExecutorQueue,
  [QUEUE_NAMES.SYNC_ANALYTICS]: syncAnalyticsQueue,
  [QUEUE_NAMES.ALERTS]: alertsQueue,
  [QUEUE_NAMES.TRIGGER_RUNNER]: triggerRunnerQueue,
  [QUEUE_NAMES.KNOWLEDGE_RETENTION]: knowledgeRetentionQueue,
  [QUEUE_NAMES.SYNC_CONNECTOR_DLQ]: syncConnectorDLQ,
  [QUEUE_NAMES.EXECUTE_TASK_DLQ]: executeTaskDLQ,
  [QUEUE_NAMES.ACTION_EXECUTOR_DLQ]: actionExecutorDLQ,
  [QUEUE_NAMES.SYNC_ANALYTICS_DLQ]: syncAnalyticsDLQ,
  [QUEUE_NAMES.ALERTS_DLQ]: alertsDLQ,
  [QUEUE_NAMES.TRIGGER_RUNNER_DLQ]: triggerRunnerDLQ,
  [QUEUE_NAMES.BOARD_MEETING]: boardMeetingQueue,
  [QUEUE_NAMES.BOARD_MEETING_DLQ]: boardMeetingDLQ,
  [QUEUE_NAMES.KNOWLEDGE_RETENTION_DLQ]: knowledgeRetentionDLQ,
};

/**
 * Initialize all queues
 */
export const initializeQueues = async (): Promise<void> => {
  try {
    queueLogger.info('Initializing queues...');

    // Test Redis connection
    await getRedisConnection().ping();

    // Wait for queues to be ready
    await Promise.all([
      syncConnectorQueue.waitUntilReady(),
      executeTaskQueue.waitUntilReady(),
      actionExecutorQueue.waitUntilReady(),
      syncAnalyticsQueue.waitUntilReady(),
      alertsQueue.waitUntilReady(),
      triggerRunnerQueue.waitUntilReady(),
      knowledgeRetentionQueue.waitUntilReady(),
      boardMeetingQueue.waitUntilReady(),
      syncConnectorDLQ.waitUntilReady(),
      executeTaskDLQ.waitUntilReady(),
      actionExecutorDLQ.waitUntilReady(),
      syncAnalyticsDLQ.waitUntilReady(),
      alertsDLQ.waitUntilReady(),
      triggerRunnerDLQ.waitUntilReady(),
      knowledgeRetentionDLQ.waitUntilReady(),
      boardMeetingDLQ.waitUntilReady(),
    ]);

    queueLogger.info('All queues initialized successfully', {
      queues: Object.keys(queues),
    });

    registerQueueMetrics(queues);
  } catch (error) {
    queueLogger.error('Failed to initialize queues', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Gracefully close all queues and Redis connection
 */
export const closeQueues = async (): Promise<void> => {
  try {
    queueLogger.info('Closing queues...');

    await Promise.all([
      syncConnectorQueue.close(),
      executeTaskQueue.close(),
      actionExecutorQueue.close(),
      syncAnalyticsQueue.close(),
      alertsQueue.close(),
      triggerRunnerQueue.close(),
      knowledgeRetentionQueue.close(),
      boardMeetingQueue.close(),
      syncConnectorDLQ.close(),
      executeTaskDLQ.close(),
      actionExecutorDLQ.close(),
      syncAnalyticsDLQ.close(),
      alertsDLQ.close(),
      triggerRunnerDLQ.close(),
      knowledgeRetentionDLQ.close(),
      boardMeetingDLQ.close(),
    ]);

    if (redisConnection) {
      await redisConnection.quit();
      redisConnection = null;
    }

    queueLogger.info('All queues closed successfully');
  } catch (error) {
    queueLogger.error('Error closing queues', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

/**
 * Health check for queues
 */
export const checkQueueHealth = async (): Promise<{
  healthy: boolean;
  queues: Record<string, { active: number; waiting: number; failed: number }>;
}> => {
  try {
    const queueStats = await Promise.all(
      Object.entries(queues).map(async ([name, queue]) => {
        const [active, waiting, failed] = await Promise.all([
          queue.getActiveCount(),
          queue.getWaitingCount(),
          queue.getFailedCount(),
        ]);

        return [name, { active, waiting, failed }] as const;
      })
    );

    return {
      healthy: true,
      queues: Object.fromEntries(queueStats),
    };
  } catch (error) {
    queueLogger.error('Queue health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      healthy: false,
      queues: {},
    };
  }
};

// Event listeners for queue monitoring
syncConnectorQueue.on('error', (error) => {
  queueLogger.error('Sync connector queue error', { error: error.message });
});

executeTaskQueue.on('error', (error) => {
  queueLogger.error('Execute task queue error', { error: error.message });
});

actionExecutorQueue.on('error', (error) => {
  queueLogger.error('Action executor queue error', { error: error.message });
});

syncConnectorDLQ.on('error', (error) => {
  queueLogger.error('Sync connector DLQ error', { error: error.message });
});

executeTaskDLQ.on('error', (error) => {
  queueLogger.error('Execute task DLQ error', { error: error.message });
});

actionExecutorDLQ.on('error', (error) => {
  queueLogger.error('Action executor DLQ error', { error: error.message });
});

syncAnalyticsQueue.on('error', (error) => {
  queueLogger.error('Sync analytics queue error', { error: error.message });
});

syncAnalyticsDLQ.on('error', (error) => {
  queueLogger.error('Sync analytics DLQ error', { error: error.message });
});

alertsQueue.on('error', (error) => {
  queueLogger.error('Alerts queue error', { error: error.message });
});

alertsDLQ.on('error', (error) => {
  queueLogger.error('Alerts DLQ error', { error: error.message });
});

triggerRunnerQueue.on('error', (error) => {
  queueLogger.error('Trigger runner queue error', { error: error.message });
});

triggerRunnerDLQ.on('error', (error) => {
  queueLogger.error('Trigger runner DLQ error', { error: error.message });
});

boardMeetingQueue.on('error', (error) => {
  queueLogger.error('Board meeting queue error', { error: error.message });
});

boardMeetingDLQ.on('error', (error) => {
  queueLogger.error('Board meeting DLQ error', { error: error.message });
});
