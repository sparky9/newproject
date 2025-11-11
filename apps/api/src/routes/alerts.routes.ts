import { Router as createRouter } from 'express';
import type { Router } from 'express';
import { z } from 'zod';
import { createTenantClient } from '@ocsuite/db';
import type { Prisma } from '@ocsuite/db';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { apiLogger } from '../utils/logger.js';
import { trackTenantEvent } from '../utils/telemetry.js';

const router: Router = createRouter();

const STATUS_VALUES = ['pending', 'acknowledged', 'resolved', 'snoozed'] as const;
const SEVERITY_VALUES = ['info', 'warning', 'critical'] as const;

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  ruleId: z.string().uuid().optional(),
});

router.get(
  '/',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const parse = listQuerySchema.safeParse(req.query ?? {});

    if (!parse.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid query parameters',
        details: parse.error.format(),
      });
    }

    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;
    const db = createTenantClient({ tenantId, userId: clerkId });

    try {
      const { limit = 25, cursor, status, severity, ruleId } = parse.data;

      const where: Prisma.AlertWhereInput = {
        tenantId,
      };

      if (status) {
        where.status = status;
      }

      if (severity) {
        where.severity = severity;
      }

      if (ruleId) {
        where.ruleId = ruleId;
      }

      const [alerts, pendingCount, criticalPendingCount] = await Promise.all([
        db.alert.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          take: limit,
          ...(cursor
            ? {
                skip: 1,
                cursor: { id: cursor },
              }
            : {}),
        }),
        db.alert.count({
          where: {
            tenantId,
            status: 'pending',
          },
        }),
        db.alert.count({
          where: {
            tenantId,
            status: 'pending',
            severity: 'critical',
          },
        }),
      ]);

      return res.status(200).json({
        alerts,
        nextCursor: alerts.length === limit ? alerts.at(-1)?.id : undefined,
        stats: {
          pending: pendingCount,
          criticalPending: criticalPendingCount,
        },
      });
    } catch (error) {
      apiLogger.error('Failed to list alerts', {
        tenantId,
        clerkId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to load alerts',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.post(
  '/:id/acknowledge',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const { id } = req.params as { id?: string };

    if (!id) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Alert ID is required',
      });
    }

    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;
    const db = createTenantClient({ tenantId, userId: clerkId });

    try {
      const user = await db.user.findFirst({
        where: { clerkId },
        select: { id: true },
      });

      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found for acknowledgement',
        });
      }

      const alert = await db.alert.findFirst({
        where: {
          id,
          tenantId,
        },
      });

      if (!alert) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Alert not found',
        });
      }

      if (alert.status === 'acknowledged' || alert.status === 'resolved') {
        return res.status(200).json({ alert });
      }

      const updated = await db.alert.update({
        where: { id },
        data: {
          status: 'acknowledged',
          acknowledgedAt: new Date(),
          acknowledgedBy: user.id,
        },
      });

      await trackTenantEvent({
        tenantId,
        distinctId: user.id,
        event: 'alert.acknowledged',
        properties: {
          alertId: updated.id,
          ruleId: updated.ruleId,
          severity: updated.severity,
        },
      });

      return res.status(200).json({ alert: updated });
    } catch (error) {
      apiLogger.error('Failed to acknowledge alert', {
        tenantId,
        clerkId,
        alertId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to acknowledge alert',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

export default router;
