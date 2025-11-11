import { Router as createRouter } from 'express';
import type { Router } from 'express';
import { z } from 'zod';
import {
  createTenantClient,
  getTenantDb,
  ActionApproval,
  Task,
  TenantMemberRole,
} from '@ocsuite/db';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import {
  submitActionApproval,
  listActionApprovals,
  approveAction,
  rejectAction,
  normalizeAuditLog,
  ActionApprovalNotFoundError,
  ActionApprovalStateError,
  payloadToRecord,
} from '../services/action-approvals.js';
import { apiLogger } from '../utils/logger.js';

const router: Router = createRouter();

const submitSchema = z.object({
  source: z.string().min(1).max(200),
  payload: z.record(z.unknown()),
  actionItemId: z.string().uuid().optional(),
  comment: z.string().max(500).optional(),
});

const ACTION_STATUS_VALUES = ['pending', 'approved', 'rejected', 'executing', 'executed', 'failed'] as const;

const listQuerySchema = z.object({
  status: z.enum(ACTION_STATUS_VALUES).optional(),
  minRisk: z.coerce.number().min(0).max(100).optional(),
  maxRisk: z.coerce.number().min(0).max(100).optional(),
  source: z.string().min(1).optional(),
  createdBy: z.string().min(1).optional(),
  limit: z.coerce.number().min(1).max(250).optional(),
});

const commentSchema = z.object({
  comment: z.string().max(500).optional(),
});

router.post(
  '/submit',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const parse = submitSchema.safeParse(req.body ?? {});

    if (!parse.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request body',
        details: parse.error.format(),
      });
    }

    const tenantId = req.tenantId!;
    const userId = req.clerkId!;

    const db = createTenantClient({ tenantId, userId });

    try {
      const result = await submitActionApproval(db, {
        tenantId,
        userId,
        source: parse.data.source,
        payload: parse.data.payload,
        actionItemId: parse.data.actionItemId,
        comment: parse.data.comment,
      });

      return res.status(201).json({
        approval: serializeApproval(result.approval),
        risk: result.risk,
      });
    } catch (error) {
      apiLogger.error('Failed to submit action approval', {
        tenantId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to submit action approval',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.get(
  '/:id/audit',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const { id } = req.params as { id?: string };

    if (!id) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Approval ID is required',
      });
    }

    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;

    const systemDb = getTenantDb();

    let tenantUserId: string | undefined;

    try {
      const membership = await systemDb.tenantMember.findFirst({
        where: {
          tenantId,
          user: {
            clerkId,
          },
        },
        select: {
          role: true,
          userId: true,
        },
      });

      if (!membership || (membership.role !== TenantMemberRole.owner && membership.role !== TenantMemberRole.admin)) {
        return res.status(403).json({
          error: 'forbidden',
          message: 'Audit log access requires owner or admin role',
        });
      }

      tenantUserId = membership.userId;

      const db = createTenantClient({ tenantId, userId: tenantUserId });

      try {
        const approval = await db.actionApproval.findUnique({
          where: { id },
        });

        if (!approval) {
          return res.status(404).json({
            error: 'not_found',
            message: 'Approval not found',
          });
        }

        return res.status(200).json({
          id: approval.id,
          tenantId: approval.tenantId,
          actionItemId: approval.actionItemId,
          status: approval.status,
          source: approval.source,
          riskScore: approval.riskScore,
          riskLevel: riskLevelFromScore(approval.riskScore),
          payload: payloadToRecord(approval.payload),
          createdBy: approval.createdBy,
          approvedBy: approval.approvedBy,
          approvedAt: approval.approvedAt,
          executedAt: approval.executedAt,
          auditLog: normalizeAuditLog(approval.auditLog),
          createdAt: approval.createdAt,
          updatedAt: approval.updatedAt,
        });
      } finally {
        await db.$disconnect();
      }
    } catch (error) {
      apiLogger.error('Failed to retrieve action audit log', {
        tenantId,
        approvalId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to retrieve audit log',
      });
    }
  }
);

router.get(
  '/pending',
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
    const userId = req.clerkId!;

    const db = createTenantClient({ tenantId, userId });

    try {
      const filters = parse.data;

      const approvals = await listActionApprovals(db, {
        status: filters.status ?? 'pending',
        minRisk: filters.minRisk,
        maxRisk: filters.maxRisk,
        source: filters.source,
        createdBy: filters.createdBy,
        limit: filters.limit,
      });

      return res.status(200).json({
        approvals: approvals.map(serializeApproval),
      });
    } catch (error) {
      apiLogger.error('Failed to list action approvals', {
        tenantId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to list action approvals',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.post(
  '/:id/approve',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const parse = commentSchema.safeParse(req.body ?? {});

    if (!parse.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request body',
        details: parse.error.format(),
      });
    }

    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const { id } = req.params as { id: string };

    if (!id) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Approval ID is required',
      });
    }

    const db = createTenantClient({ tenantId, userId });

    try {
      const result = await approveAction(db, {
        tenantId,
        userId,
        approvalId: id,
        comment: parse.data.comment,
      });

      return res.status(200).json({
        approval: serializeApproval(result.approval),
        task: serializeTask(result.task),
        job: result.job,
      });
    } catch (error) {
      if (error instanceof ActionApprovalNotFoundError) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Approval not found',
        });
      }

      if (error instanceof ActionApprovalStateError) {
        return res.status(409).json({
          error: 'invalid_state',
          message: error.message,
        });
      }

      apiLogger.error('Failed to approve action', {
        tenantId,
        userId,
        approvalId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to approve action',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.post(
  '/:id/reject',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const parse = commentSchema.safeParse(req.body ?? {});

    if (!parse.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request body',
        details: parse.error.format(),
      });
    }

    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const { id } = req.params as { id: string };

    if (!id) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Approval ID is required',
      });
    }

    const db = createTenantClient({ tenantId, userId });

    try {
      const approval = await rejectAction(db, {
        tenantId,
        userId,
        approvalId: id,
        comment: parse.data.comment,
      });

      return res.status(200).json({
        approval: serializeApproval(approval),
      });
    } catch (error) {
      if (error instanceof ActionApprovalNotFoundError) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Approval not found',
        });
      }

      if (error instanceof ActionApprovalStateError) {
        return res.status(409).json({
          error: 'invalid_state',
          message: error.message,
        });
      }

      apiLogger.error('Failed to reject action', {
        tenantId,
        userId,
        approvalId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to reject action',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

function serializeApproval(approval: ActionApproval) {
  return {
    id: approval.id,
    tenantId: approval.tenantId,
    actionItemId: approval.actionItemId,
    source: approval.source,
    payload: approval.payload,
    riskScore: approval.riskScore,
    riskLevel: riskLevelFromScore(approval.riskScore),
    status: approval.status,
    createdBy: approval.createdBy,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    executedAt: approval.executedAt,
    auditLog: normalizeAuditLog(approval.auditLog),
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
  };
}

function serializeTask(task: Task) {
  return {
    id: task.id,
    status: task.status,
    priority: task.priority,
    jobId: task.jobId,
    queueName: task.queueName,
    tenantId: task.tenantId,
    userId: task.userId,
    type: task.type,
    moduleSlug: task.moduleSlug,
    actionApprovalId: task.actionApprovalId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function riskLevelFromScore(score: number): 'low' | 'medium' | 'high' {
  if (score <= 33) {
    return 'low';
  }
  if (score >= 67) {
    return 'high';
  }
  return 'medium';
}

export default router;
