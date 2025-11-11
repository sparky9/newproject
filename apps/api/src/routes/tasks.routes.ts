import { Router as createRouter } from 'express';
import type { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createTenantClient } from '@ocsuite/db';
import { requireAuth, verifyClerkToken } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { enqueueTaskExecution, getJobStatus } from '../queue/client.js';
import { apiLogger } from '../utils/logger.js';
import { QUEUE_NAMES } from '../queue/index.js';
import { toInputJson, parseJsonRecord } from '../utils/json.js';

/**
 * Custom auth middleware for SSE that supports token via query parameter
 * EventSource doesn't support custom headers, so we need this workaround
 */
const requireAuthSSE = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Try to get token from Authorization header first
      let token = req.headers.authorization?.substring(7);

      // If not in header, check query parameter
      if (!token && req.query.token) {
        token = req.query.token as string;
      }

      if (!token) {
        apiLogger.warn('SSE authentication failed: No token provided', {
          path: req.path,
        });
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication token required',
          code: 'AUTH_REQUIRED',
        });
      }

      // Verify token with Clerk
  const decoded = await verifyClerkToken(token);

      // Attach auth information to request
      req.auth = {
        userId: decoded.sub,
        sessionId: decoded.sid || '',
        claims: decoded,
      };

      req.clerkId = decoded.sub;

      apiLogger.debug('SSE authentication successful', {
        userId: decoded.sub,
      });

      next();
    } catch (error) {
      apiLogger.error('SSE authentication error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authentication token',
        code: 'INVALID_TOKEN',
      });
    }
  };
};

const router: Router = createRouter();

/**
 * Request validation schema for task execution endpoint
 */
const executeTaskRequestSchema = z.object({
  taskType: z.string().min(1, 'Task type cannot be empty').max(100, 'Task type too long'),
  payload: z.record(z.unknown()).default({}),
});

/**
 * POST /execute
 *
 * Execute a task by creating a task record and enqueuing it for processing
 *
 * Request body:
 * - taskType: string (required) - The type of task to execute
 * - payload: object (optional) - Task-specific payload data
 *
 * Response:
 * - taskId: string - The ID of the created task record
 * - jobId: string - The ID of the queued job
 * - status: "queued" - Initial status
 */
router.post(
  '/execute',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    try {
      // Validate request body
      const parseResult = executeTaskRequestSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request data',
          details: parseResult.error.format(),
          code: 'VALIDATION_ERROR',
        });
      }

  const { taskType, payload } = parseResult.data;
      const tenantId = req.tenantId!;
      const userId = req.clerkId!;

      apiLogger.info('Task execution request received', {
        tenantId,
        userId,
        taskType,
        payloadKeys: Object.keys(payload),
      });

      // Get tenant-scoped database client
      const db = createTenantClient({ tenantId, userId });

      // Create task record in database
      const task = await db.task.create({
        data: {
          tenantId,
          userId,
          type: taskType,
          status: 'pending',
          priority: 'normal',
          payload: toInputJson(payload),
        },
      });

      apiLogger.info('Created task record', {
        taskId: task.id,
        taskType,
        tenantId,
        userId,
      });

      // Enqueue task for execution
      const jobResult = await enqueueTaskExecution(
        tenantId,
        task.id,
        userId,
        payload
      );

      apiLogger.info('Enqueued task execution job', {
        taskId: task.id,
        jobId: jobResult.jobId,
        tenantId,
        userId,
      });

      // Update task with job ID
      await db.task.update({
        where: { id: task.id },
        data: {
          jobId: jobResult.jobId,
          queueName: jobResult.queueName,
        },
      });

      await db.$disconnect();

      // Return success response
      return res.status(200).json({
        taskId: task.id,
        jobId: jobResult.jobId,
        queueName: jobResult.queueName,
        status: 'queued',
        taskType,
        enqueuedAt: jobResult.enqueuedAt,
      });

    } catch (error) {
      apiLogger.error('Error executing task', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        tenantId: req.tenantId,
        userId: req.clerkId,
        taskType: req.body?.taskType,
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to execute task',
        code: 'TASK_EXECUTION_ERROR',
      });
    }
  }
);

/**
 * GET /:taskId
 *
 * Get the status and details of a specific task
 *
 * Path parameters:
 * - taskId: string - The UUID of the task
 *
 * Response:
 * - Task details including status, payload, result, and queue metadata
 */
router.get(
  '/:taskId',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const tenantId = req.tenantId!;
      const userId = req.clerkId!;

      // Validate taskId format
  const taskIdSchema = z.string().uuid().or(z.string().cuid());
      const parseResult = taskIdSchema.safeParse(taskId);

      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid task ID format',
          code: 'INVALID_TASK_ID',
        });
      }

      apiLogger.info('Fetching task details', {
        taskId,
        tenantId,
        userId,
      });

      // Get tenant-scoped database client
      const db = createTenantClient({ tenantId, userId });

      // Fetch task
      const task = await db.task.findUnique({
        where: { id: taskId },
      });

      await db.$disconnect();

      if (!task) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: 'Task not found',
          },
        });
      }

      const taskPayload = task.payload ? parseJsonRecord(task.payload) : {};

      // Return task details
      return res.status(200).json({
        success: true,
        data: {
          id: task.id,
          type: task.type,
          status: task.status,
          priority: task.priority,
          payload: taskPayload,
          result: task.result,
          error: task.error,
          jobId: task.jobId,
          queueName: task.queueName,
          executedAt: task.executedAt,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        },
      });

    } catch (error) {
      apiLogger.error('Error fetching task', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        taskId: req.params.taskId,
        tenantId: req.tenantId,
        userId: req.clerkId,
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch task',
        code: 'TASK_FETCH_ERROR',
      });
    }
  }
);

/**
 * GET /:taskId/stream
 *
 * Server-Sent Events (SSE) endpoint that streams real-time task status updates
 *
 * Path parameters:
 * - taskId: string - The UUID of the task
 *
 * Events emitted:
 * - progress: Task progress updates with percentage and metadata
 * - completed: Task completed successfully
 * - failed: Task failed with error details
 * - error: Error occurred while streaming
 */
router.get(
  '/:taskId/stream',
  requireAuthSSE(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const tenantId = req.tenantId!;
      const userId = req.clerkId!;

      // Validate taskId format
  const taskIdSchema = z.string().uuid().or(z.string().cuid());
      const parseResult = taskIdSchema.safeParse(taskId);

      if (!parseResult.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Validation Error',
          message: 'Invalid task ID format',
          code: 'INVALID_TASK_ID',
        }));
        return;
      }

      apiLogger.info('SSE stream requested', {
        taskId,
        tenantId,
        userId,
      });

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      });

      // Get tenant-scoped database client
      const db = createTenantClient({ tenantId, userId });

      // Get task and verify it exists
      const task = await db.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Task not found' })}\n\n`);
        res.end();
        await db.$disconnect();
        return;
      }

      apiLogger.info('Task found, starting SSE stream', {
        taskId,
        taskType: task.type,
        currentStatus: task.status,
      });

      // Extract job information
      const jobId = (req.query.jobId as string) || task.jobId || undefined;
      const queueName = (req.query.queueName as string) || task.queueName || QUEUE_NAMES.EXECUTE_TASK;

      if (!jobId || !queueName) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Task has no associated job' })}\n\n`);
        res.end();
        await db.$disconnect();
        return;
      }

      // Send initial status
      res.write(`event: connected\ndata: ${JSON.stringify({
        taskId,
        jobId,
        status: task.status,
        message: 'Connected to task stream'
      })}\n\n`);

      let pollInterval: NodeJS.Timeout | null = null;
      let isStreamClosed = false;

      // Clean up function
      const cleanup = async () => {
        if (isStreamClosed) return;
        isStreamClosed = true;

        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }

        await db.$disconnect();

        apiLogger.info('SSE stream closed', {
          taskId,
          tenantId,
          userId,
        });
      };

      // Poll job status every 1 second
      pollInterval = setInterval(async () => {
        if (isStreamClosed) return;

        try {
          // Get job status from BullMQ
          const jobStatus = await getJobStatus(queueName, jobId);

          // Get latest task status from database
          const latestTask = await db.task.findUnique({
            where: { id: taskId },
          });

          if (!latestTask) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: 'Task not found' })}\n\n`);
            await cleanup();
            res.end();
            return;
          }

          // Prepare status update
          const statusUpdate = {
            taskId,
            jobId,
            taskStatus: latestTask.status,
            jobState: jobStatus.state,
            progress: jobStatus.progress,
            data: jobStatus.data,
            timestamp: Date.now(),
            startedAt: latestTask.createdAt,
            completedAt: latestTask.executedAt,
            queueName,
            result: latestTask.result,
            error: latestTask.error,
          };

          // Emit progress event
          res.write(`event: progress\ndata: ${JSON.stringify(statusUpdate)}\n\n`);

          // Check if task is complete or failed
          if (jobStatus.state === 'completed' || latestTask.status === 'completed') {
            res.write(`event: completed\ndata: ${JSON.stringify({
              ...statusUpdate,
              result: latestTask.result,
              returnValue: jobStatus.returnvalue,
            })}\n\n`);
            await cleanup();
            res.end();
            return;
          }

          if (jobStatus.state === 'failed' || latestTask.status === 'failed') {
            res.write(`event: failed\ndata: ${JSON.stringify({
              ...statusUpdate,
              error: latestTask.error,
              failedReason: jobStatus.failedReason,
              attemptsMade: jobStatus.attemptsMade,
            })}\n\n`);
            await cleanup();
            res.end();
            return;
          }

        } catch (error) {
          apiLogger.error('Error polling job status', {
            error: error instanceof Error ? error.message : 'Unknown error',
            taskId,
            jobId,
          });

          res.write(`event: error\ndata: ${JSON.stringify({
            message: 'Failed to get status',
            error: error instanceof Error ? error.message : 'Unknown error'
          })}\n\n`);
          await cleanup();
          res.end();
        }
      }, 1000);

      // Clean up on client disconnect
      req.on('close', async () => {
        apiLogger.info('Client disconnected from SSE stream', {
          taskId,
          tenantId,
          userId,
        });
        await cleanup();
      });

      // Clean up on server error
      res.on('error', async (error) => {
        apiLogger.error('SSE stream error', {
          error: error.message,
          taskId,
          tenantId,
          userId,
        });
        await cleanup();
      });

    } catch (error) {
      apiLogger.error('Error setting up SSE stream', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        taskId: req.params.taskId,
        tenantId: req.tenantId,
        userId: req.clerkId,
      });

      // If headers not sent yet, send error response
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to establish SSE stream',
          code: 'SSE_STREAM_ERROR',
        });
      }
    }
  }
);

export default router;
