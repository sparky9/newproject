import { Router as createRouter } from 'express';
import type { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { prisma } from '@ocsuite/db';
import { getRedisConnection } from '../queue/index.js';
import { getMetrics } from '../utils/metrics.js';
import {
  syncConnectorQueue,
  executeTaskQueue,
  syncAnalyticsQueue,
  actionExecutorQueue,
} from '../queue/index.js';
import { growthPulseQueue } from '../workers/modules/growth-pulse.worker.js';

const router: Router = createRouter();

// Basic health check
router.get('/health', asyncHandler(async (_req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  res.json(health);
}));

// Detailed health check with dependencies
router.get('/health/detailed', asyncHandler(async (_req, res) => {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkQueues(),
  ]);

  const health = {
    status: checks.every(c => c.status === 'fulfilled' && c.value.status === 'healthy') ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: checks[0].status === 'fulfilled' ? checks[0].value : { status: 'unhealthy', error: 'Failed to check' },
      redis: checks[1].status === 'fulfilled' ? checks[1].value : { status: 'unhealthy', error: 'Failed to check' },
      queues: checks[2].status === 'fulfilled' ? checks[2].value : { status: 'unhealthy', error: 'Failed to check' },
    },
  };

  res.status(health.status === 'healthy' ? 200 : 503).json(health);
}));

// Queue health
router.get('/health/queues', asyncHandler(async (_req, res) => {
  const queueHealth = await checkQueues();
  res.json(queueHealth);
}));

// Metrics endpoint
router.get('/metrics', asyncHandler(async (_req, res) => {
  const metrics = getMetrics();
  res.json(metrics);
}));

// Helper functions
async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy' as const, responseTime: 0 };
  } catch (error: unknown) {
    return {
      status: 'unhealthy' as const,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkRedis() {
  try {
    const redis = getRedisConnection();
    await redis.ping();
    return { status: 'healthy' as const };
  } catch (error: unknown) {
    return {
      status: 'unhealthy' as const,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkQueues() {
  try {
    const [
      syncConnectorCounts,
      executeTaskCounts,
      actionExecutorCounts,
      syncAnalyticsCounts,
      growthPulseCounts,
    ] = await Promise.all([
      syncConnectorQueue.getJobCounts(),
      executeTaskQueue.getJobCounts(),
      actionExecutorQueue.getJobCounts(),
      syncAnalyticsQueue.getJobCounts(),
      growthPulseQueue.getJobCounts(),
    ]);

    return {
      status: 'healthy' as const,
      queues: {
        'sync-connector': syncConnectorCounts,
        'execute-task': executeTaskCounts,
        'action-executor': actionExecutorCounts,
        'sync-analytics': syncAnalyticsCounts,
        'growth-pulse': growthPulseCounts,
      },
    };
  } catch (error: unknown) {
    return {
      status: 'unhealthy' as const,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default router;
