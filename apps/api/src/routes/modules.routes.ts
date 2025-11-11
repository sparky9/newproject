import { Router as createRouter } from 'express';
import type { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { createTenantClient } from '@ocsuite/db';
import { growthPulseQueue } from '../workers/modules/growth-pulse.worker.js';
import { apiLogger } from '../utils/logger.js';

const router: Router = createRouter();

/**
 * GET /modules/insights
 *
 * Fetch all module insights for the current tenant (optionally filtered by moduleSlug)
 */
router.get(
  '/insights',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const moduleSlug = req.query.moduleSlug as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    const prisma = createTenantClient({ tenantId, userId });

    try {
      const whereClause = {
        tenantId,
        ...(moduleSlug && { moduleSlug }),
      };

      const [insights, total] = await Promise.all([
        prisma.moduleInsight.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.moduleInsight.count({
          where: whereClause,
        }),
      ]);

      return res.status(200).json({
        success: true,
        data: insights,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      apiLogger.error('Failed to fetch module insights', {
        tenantId,
        moduleSlug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'INSIGHTS_FETCH_ERROR',
          message: 'Failed to fetch insights',
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
);

/**
 * GET /modules/growth-pulse/insights
 *
 * Fetch Growth Pulse insights for the current tenant
 */
router.get(
  '/growth-pulse/insights',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    const prisma = createTenantClient({ tenantId, userId });

    try {
      const [insights, total] = await Promise.all([
        prisma.moduleInsight.findMany({
          where: {
            tenantId,
            moduleSlug: 'growth-pulse',
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.moduleInsight.count({
          where: {
            tenantId,
            moduleSlug: 'growth-pulse',
          },
        }),
      ]);

      return res.status(200).json({
        success: true,
        data: insights,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      apiLogger.error('Failed to fetch Growth Pulse insights', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'INSIGHTS_FETCH_ERROR',
          message: 'Failed to fetch insights',
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
);

/**
 * GET /modules/growth-pulse/insights/:insightId
 *
 * Fetch a specific Growth Pulse insight by ID
 */
router.get(
  '/growth-pulse/insights/:insightId',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const { insightId } = req.params;

    const prisma = createTenantClient({ tenantId, userId });

    try {
      const insight = await prisma.moduleInsight.findFirst({
        where: {
          id: insightId,
          tenantId,
          moduleSlug: 'growth-pulse',
        },
      });

      if (!insight) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'INSIGHT_NOT_FOUND',
            message: 'Insight not found',
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: insight,
      });
    } catch (error) {
      apiLogger.error('Failed to fetch Growth Pulse insight', {
        tenantId,
        insightId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'INSIGHT_FETCH_ERROR',
          message: 'Failed to fetch insight',
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
);

/**
 * POST /modules/growth-pulse/run
 *
 * Trigger a Growth Pulse analysis
 */
router.post(
  '/growth-pulse/run',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;

    try {
      const job = await growthPulseQueue.add('analyze', {
        tenantId,
        triggeredBy: userId,
        dateRange: req.body.dateRange,
      });

      apiLogger.info('Growth Pulse analysis queued', {
        jobId: job.id,
        tenantId,
        userId,
      });

      return res.status(202).json({
        success: true,
        data: {
          jobId: job.id,
          status: 'queued',
          enqueuedAt: new Date().toISOString(),
          queueName: 'growth-pulse',
        },
      });
    } catch (error) {
      apiLogger.error('Failed to queue Growth Pulse analysis', {
        tenantId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'QUEUE_ERROR',
          message: 'Failed to start analysis',
        },
      });
    }
  }
);

/**
 * GET /modules/growth-pulse/job/:jobId
 *
 * Get status of a Growth Pulse job
 */
router.get(
  '/growth-pulse/job/:jobId',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const jobId = req.params.jobId;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_JOB_ID',
          message: 'Job ID is required',
        },
      });
    }

    try {
      const job = await growthPulseQueue.getJob(jobId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: 'Job not found',
          },
        });
      }

      const state = await job.getState();
      const progress = job.progress;

      return res.status(200).json({
        success: true,
        data: {
          jobId: job.id,
          state,
          progress,
          data: job.data,
          returnvalue: job.returnvalue,
          failedReason: job.failedReason,
        },
      });
    } catch (error) {
      apiLogger.error('Failed to get job status', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'JOB_STATUS_ERROR',
          message: 'Failed to get job status',
        },
      });
    }
  }
);

export default router;
