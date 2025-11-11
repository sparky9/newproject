import { Worker, Job } from 'bullmq';
import { createHash } from 'crypto';
import { createTenantClient, ActionApproval } from '@ocsuite/db';
import {
  QUEUE_NAMES,
  ActionExecutorJobData,
  DLQJobData,
  getRedisConnection,
  actionExecutorDLQ,
} from '../queue/index.js';
import { config } from '../config/index.js';
import { workerLogger, createContextLogger } from '../utils/logger.js';
import { instrumentWorker } from '../observability/worker-metrics.js';
import { incrementJobCompletion, incrementJobFailure } from '../utils/metrics.js';
import {
  ActionApprovalNotFoundError,
  ActionApprovalStateError,
  normalizeAuditLog,
  buildAuditEntry,
  payloadToRecord,
  auditEventsToJson,
} from '../services/action-approvals.js';
import { toInputJson } from '../utils/json.js';
import type { TaskExecutionResult } from '@ocsuite/module-sdk';
import { executeModuleCapability, ModuleExecutionError } from '../modules/registry.js';
import { notifyActionExecutionResult } from '../services/notifications.js';

interface ExecutionProgress {
  phase: 'initializing' | 'validating' | 'executing' | 'finalizing' | 'completed';
  percentage: number;
  message: string;
  metadata?: Record<string, unknown>;
}

interface ActionExecutionJobResult {
  success: boolean;
  executedAt: string;
  durationMs: number;
  payloadHash: string;
  moduleSlug?: string;
  capability?: string;
  result?: TaskExecutionResult;
  skipped?: boolean;
}

interface TransactionBootstrapResult {
  taskId: string;
  alreadyExecuted: boolean;
  payloadRecord: Record<string, unknown>;
  payloadHash: string;
  moduleSlug?: string;
  capability?: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, val]) => typeof val !== 'undefined')
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, val]) => `"${key}":${stableStringify(val)}`);

  return `{${entries.join(',')}}`;
}

function computePayloadHash(
  payload: Record<string, unknown>,
  capability?: string
): string {
  const hasher = createHash('sha256');
  hasher.update(stableStringify(payload));
  if (capability) {
    hasher.update(capability);
  }
  return hasher.digest('hex');
}

async function processActionExecution(
  job: Job<ActionExecutorJobData>
): Promise<ActionExecutionJobResult> {
  const { tenantId, approvalId } = job.data;
  const actorId = job.data.approvedBy ?? job.data.createdBy ?? 'system-action-worker';
  const logger = createContextLogger('action-executor-worker', {
    jobId: job.id,
    tenantId,
    approvalId,
    moduleSlug: job.data.moduleSlug,
    capability: job.data.capability,
  });

  const db = createTenantClient({ tenantId, userId: actorId });
  const startedAt = Date.now();
  let lastBootstrap: TransactionBootstrapResult | undefined;
  let executionOutcomeApproval: ActionApproval | null = null;

  try {
    await job.updateProgress({
      phase: 'initializing',
      percentage: 5,
      message: 'Preparing action execution',
    } as ExecutionProgress);

    const bootstrap = await db.$transaction(async (tx) => {
      const record = await tx.actionApproval.findUnique({
        where: { id: approvalId },
        include: { task: true },
      });

      if (!record || record.tenantId !== tenantId) {
        throw new ActionApprovalNotFoundError();
      }

      const auditLog = normalizeAuditLog(record.auditLog);
      const payloadRecord = payloadToRecord(record.payload);
      const capability = job.data.capability ?? (typeof payloadRecord.capability === 'string' ? payloadRecord.capability : undefined);
      const moduleSlug = job.data.moduleSlug ?? (typeof payloadRecord.moduleSlug === 'string' ? payloadRecord.moduleSlug : undefined);
      const payloadHash = computePayloadHash(payloadRecord, capability);

      const executedEvent = auditLog.find((event) => event.event === 'completed' && event.metadata?.payloadHash === payloadHash);

      if (record.status === 'executed' && executedEvent) {
        return {
          taskId: record.task?.id ?? '',
          alreadyExecuted: true,
          payloadRecord,
          payloadHash,
          moduleSlug,
          capability,
        } satisfies TransactionBootstrapResult;
      }

      if (!['approved', 'executing'].includes(record.status)) {
        throw new ActionApprovalStateError('Action must be approved before execution');
      }

      const executingAudit = [
        ...auditLog,
        buildAuditEntry('executing', actorId, undefined, {
          jobId: job.id ?? undefined,
          moduleSlug,
          capability,
        }),
      ];

      const updated = await tx.actionApproval.update({
        where: { id: approvalId },
        data: {
          status: 'executing',
          auditLog: auditEventsToJson(executingAudit),
        },
        include: { task: true },
      });

      let taskId = updated.task?.id;

      if (taskId) {
        const refreshedTask = await tx.task.update({
          where: { id: taskId },
          data: {
            status: 'running',
            queueName: QUEUE_NAMES.ACTION_EXECUTOR,
            jobId: job.id ?? null,
            error: null,
          },
        });
        taskId = refreshedTask.id;
      } else {
        const createdTask = await tx.task.create({
          data: {
            tenantId,
            userId: actorId,
            type: 'action-execution',
            status: 'running',
            priority: 'normal',
            payload: toInputJson(updated.payload),
            moduleSlug: moduleSlug ?? null,
            actionApprovalId: approvalId,
            queueName: QUEUE_NAMES.ACTION_EXECUTOR,
            jobId: job.id ?? null,
          },
        });
        taskId = createdTask.id;
      }

      return {
        taskId,
        alreadyExecuted: false,
        payloadRecord,
        payloadHash,
        moduleSlug,
        capability,
      } satisfies TransactionBootstrapResult;
    });

  lastBootstrap = bootstrap;

  if (bootstrap.alreadyExecuted) {
      await job.updateProgress({
        phase: 'completed',
        percentage: 100,
        message: 'Action already executed; skipping',
        metadata: {
          payloadHash: bootstrap.payloadHash,
        },
      } as ExecutionProgress);

      logger.info('Skipping execution due to matching previous result', {
        approvalId,
        payloadHash: bootstrap.payloadHash,
      });

      return {
        success: true,
        executedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        payloadHash: bootstrap.payloadHash,
        moduleSlug: bootstrap.moduleSlug,
        capability: bootstrap.capability,
        skipped: true,
      };
    }

    await job.updateProgress({
      phase: 'validating',
      percentage: 25,
      message: 'Validating module capability',
      metadata: {
        moduleSlug: bootstrap.moduleSlug,
        capability: bootstrap.capability,
      },
    } as ExecutionProgress);

    if (!bootstrap.moduleSlug || !bootstrap.capability) {
      throw new ModuleExecutionError('Action approval is missing moduleSlug or capability');
    }

    await job.updateProgress({
      phase: 'executing',
      percentage: 55,
      message: 'Executing module capability',
      metadata: {
        moduleSlug: bootstrap.moduleSlug,
        capability: bootstrap.capability,
      },
    } as ExecutionProgress);

    const executionResult = await executeModuleCapability({
      moduleSlug: bootstrap.moduleSlug,
      capability: bootstrap.capability,
      tenantId,
      actorId,
      taskId: bootstrap.taskId,
      approvalId,
      payload: bootstrap.payloadRecord,
      db,
      logger,
    });

    await job.updateProgress({
      phase: 'finalizing',
      percentage: 85,
      message: 'Persisting execution outcome',
    } as ExecutionProgress);

    const completedAt = new Date();
    const durationMs = Date.now() - startedAt;

    await db.$transaction(async (tx) => {
      const current = await tx.actionApproval.findUnique({
        where: { id: approvalId },
      });

      if (!current) {
        throw new ActionApprovalNotFoundError();
      }

      const auditTrail = [
        ...normalizeAuditLog(current.auditLog),
        buildAuditEntry('completed', actorId, undefined, {
          jobId: job.id ?? undefined,
          durationMs,
          payloadHash: bootstrap.payloadHash,
          moduleSlug: bootstrap.moduleSlug,
          capability: bootstrap.capability,
          undoPayload: job.data.undoPayload ?? null,
        }),
      ];

      const executedApproval = await tx.actionApproval.update({
        where: { id: approvalId },
        data: {
          status: 'executed',
          executedAt: completedAt,
          auditLog: auditEventsToJson(auditTrail),
        },
      });

      executionOutcomeApproval = executedApproval;

      await tx.task.update({
        where: { id: bootstrap.taskId },
        data: {
          status: 'completed',
          result: toInputJson(executionResult),
          executedAt: completedAt,
          error: null,
        },
      });
    });

    await job.updateProgress({
      phase: 'completed',
      percentage: 100,
      message: 'Action executed successfully',
    } as ExecutionProgress);

    if (executionOutcomeApproval) {
      await notifyActionExecutionResult(db, {
        tenantId,
        approval: executionOutcomeApproval,
        actorClerkId: actorId,
        result: 'executed',
        metadata: {
          durationMs,
          taskId: bootstrap.taskId,
          moduleSlug: bootstrap.moduleSlug,
          capability: bootstrap.capability,
        },
      });
    }

    logger.info('Action execution completed', {
      approvalId,
      taskId: bootstrap.taskId,
      payloadHash: bootstrap.payloadHash,
      durationMs,
    });

    return {
      success: true,
      executedAt: completedAt.toISOString(),
      durationMs,
      payloadHash: bootstrap.payloadHash,
      moduleSlug: bootstrap.moduleSlug,
      capability: bootstrap.capability,
      result: executionResult,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Action execution failed', {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    try {
      await db.$transaction(async (tx) => {
        const current = await tx.actionApproval.findUnique({
          where: { id: approvalId },
        });

        if (current) {
          const failureAudit = [
            ...normalizeAuditLog(current.auditLog),
            buildAuditEntry('failed', actorId, message, {
              jobId: job.id ?? undefined,
              moduleSlug: lastBootstrap?.moduleSlug ?? job.data.moduleSlug,
              capability: lastBootstrap?.capability ?? job.data.capability,
            }),
          ];

          const failedApproval = await tx.actionApproval.update({
            where: { id: approvalId },
            data: {
              status: 'failed',
              auditLog: auditEventsToJson(failureAudit),
            },
          });

          executionOutcomeApproval = failedApproval;
        }

        const task = await tx.task.findFirst({
          where: { actionApprovalId: approvalId },
        });

        if (task) {
          await tx.task.update({
            where: { id: task.id },
            data: {
              status: 'failed',
              error: message,
            },
          });
        }
      });
    } catch (updateError) {
      logger.error('Failed to persist action failure state', {
        error: updateError instanceof Error ? updateError.message : 'Unknown error',
      });
    }

    if (executionOutcomeApproval) {
      await notifyActionExecutionResult(db, {
        tenantId,
        approval: executionOutcomeApproval,
        actorClerkId: actorId,
        result: 'failed',
        metadata: {
          jobId: job.id,
          moduleSlug: lastBootstrap?.moduleSlug ?? job.data.moduleSlug,
          capability: lastBootstrap?.capability ?? job.data.capability,
          error: message,
        },
      });
    }

    throw error instanceof Error ? error : new Error(message);
  } finally {
    await db.$disconnect();
  }
}

async function handleJobFailure(
  job: Job<ActionExecutorJobData>,
  error: Error
): Promise<void> {
  const logger = createContextLogger('action-executor-dlq', {
    jobId: job.id,
    tenantId: job.data.tenantId,
    approvalId: job.data.approvalId,
  });

  logger.error('Moving action execution job to DLQ', {
    error: error.message,
    attempts: job.attemptsMade,
  });

  const dlqPayload: DLQJobData = {
    originalQueue: QUEUE_NAMES.ACTION_EXECUTOR,
    originalJobId: job.id!,
    tenantId: job.data.tenantId,
    failedData: job.data,
    failureReason: error.message,
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
  };

  try {
    await actionExecutorDLQ.add('action-executor-failed', dlqPayload, {
      removeOnComplete: false,
      removeOnFail: false,
    });
    logger.info('Job moved to action executor DLQ');
  } catch (dlqError) {
    logger.error('Failed to enqueue job in action executor DLQ', {
      error: dlqError instanceof Error ? dlqError.message : 'Unknown error',
    });
  }
}

export const createActionExecutorWorker = (): Worker<ActionExecutorJobData> => {
  const worker = new Worker<ActionExecutorJobData>(
    QUEUE_NAMES.ACTION_EXECUTOR,
    processActionExecution,
    {
      connection: getRedisConnection(),
      concurrency: config.queueActionExecutorConcurrency,
      removeOnComplete: { count: config.queueRemoveOnComplete },
      removeOnFail: { count: config.queueRemoveOnFail },
    }
  );

  worker.on('completed', (job, result: ActionExecutionJobResult) => {
    incrementJobCompletion(QUEUE_NAMES.ACTION_EXECUTOR);
    workerLogger.info('Action executor job completed', {
      jobId: job.id,
      tenantId: job.data.tenantId,
      approvalId: job.data.approvalId,
      durationMs: result.durationMs,
      skipped: result.skipped ?? false,
    });
  });

  worker.on('failed', async (job, error) => {
    if (job) {
      incrementJobFailure(QUEUE_NAMES.ACTION_EXECUTOR);
      workerLogger.error('Action executor job failed', {
        jobId: job.id,
        tenantId: job.data.tenantId,
        approvalId: job.data.approvalId,
        error: error.message,
        attempts: job.attemptsMade,
      });

      if (job.attemptsMade >= config.queueMaxRetries) {
        await handleJobFailure(job, error);
      }
    }
  });

  worker.on('error', (error) => {
    workerLogger.error('Action executor worker error', {
      error: error.message,
    });
  });

  worker.on('stalled', (jobId) => {
    workerLogger.warn('Action executor job stalled', { jobId });
  });

  workerLogger.info('Action executor worker created', {
    concurrency: config.queueActionExecutorConcurrency,
  });

  return instrumentWorker(worker);
};

// Expose internals for targeted unit testing without spinning up a BullMQ worker
export const __test__ = {
  processActionExecution,
};
