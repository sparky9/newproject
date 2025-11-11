import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantClient } from '@ocsuite/db';
import {
  submitActionApproval,
  listActionApprovals,
  approveAction,
  rejectAction,
  ActionApprovalStateError,
} from '../../../src/services/action-approvals.js';
import {
  cleanupTestData,
  createTestTenant,
  createTestUser,
  generateTestId,
} from '../../utils/test-helpers.js';

const mocks = vi.hoisted(() => {
  const enqueueMock = vi.fn(async () => ({
    jobId: 'job-123',
    queueName: 'action-executor',
    enqueuedAt: new Date().toISOString(),
  }));
  const notifySubmitted = vi.fn().mockResolvedValue(undefined);
  const notifyDecision = vi.fn().mockResolvedValue(undefined);
  return { enqueueMock, notifySubmitted, notifyDecision };
});

vi.mock('../../../src/queue/client.js', () => ({
  enqueueActionExecution: mocks.enqueueMock,
}));

vi.mock('../../../src/services/notifications.js', () => ({
  notifyActionApprovalSubmitted: mocks.notifySubmitted,
  notifyActionApprovalDecision: mocks.notifyDecision,
  notifyActionExecutionResult: vi.fn().mockResolvedValue(undefined),
}));

const { enqueueMock, notifySubmitted, notifyDecision } = mocks;

const tenantId = generateTestId('phase4-tenant');
const userId = generateTestId('phase4-user');

async function resetTenantData() {
  const db = createTenantClient({ tenantId, userId });
  try {
    await db.notification.deleteMany();
    await db.task.deleteMany();
    await db.actionApproval.deleteMany();
  } finally {
    await db.$disconnect();
  }
}

describe('action-approvals service', () => {
  beforeAll(async () => {
    await createTestTenant(tenantId);
    await createTestUser(tenantId, userId);
  });

  afterAll(async () => {
    await cleanupTestData(tenantId, userId);
  });

  beforeEach(async () => {
    enqueueMock.mockClear();
    notifySubmitted.mockClear();
    notifyDecision.mockClear();
    await resetTenantData();
  });

  it('submits an approval request with calculated risk metadata', async () => {
    const db = createTenantClient({ tenantId, userId });
    const payload = {
      moduleSlug: 'finance-orchestrator',
      capability: 'delete-records',
      impact: 'Global purge',
      connectors: ['stripe', 'netsuite'],
    };

    const result = await submitActionApproval(db, {
      tenantId,
      userId,
      source: 'module:finance',
      payload,
      comment: 'Dangerous action',
    });

    expect(result.approval.status).toBe('pending');
    expect(result.approval.riskScore).toBe(result.risk.score);
    expect(result.risk.level).toBe('high');
    expect(result.risk.reasons.length).toBeGreaterThan(0);
    expect(notifySubmitted).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId,
        approval: expect.objectContaining({ id: result.approval.id }),
        comment: 'Dangerous action',
      })
    );
    await db.$disconnect();
  });

  it('approves an action, enqueues execution, and records a task', async () => {
    const db = createTenantClient({ tenantId, userId });

    const { approval } = await submitActionApproval(db, {
      tenantId,
      userId,
      source: 'module:revops',
      payload: {
        moduleSlug: 'revops-automation',
        capability: 'bulk-update',
        connectors: ['salesforce'],
      },
    });

    const result = await approveAction(db, {
      tenantId,
      userId,
      approvalId: approval.id,
      comment: 'Looks OK',
    });

    expect(result.approval.status).toBe('approved');
    expect(result.task).toMatchObject({
      actionApprovalId: approval.id,
      status: 'pending',
      priority: 'normal',
    });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(notifyDecision).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId,
        decision: 'approved',
        comment: 'Looks OK',
      })
    );

    const approvals = await listActionApprovals(db, { status: 'approved' });
    const matching = approvals.find((item) => item.id === approval.id);
    expect(matching?.status).toBe('approved');

    await db.$disconnect();
  });

  it('rejects an action and updates audit log', async () => {
    const db = createTenantClient({ tenantId, userId });

    const { approval } = await submitActionApproval(db, {
      tenantId,
      userId,
      source: 'module:engage',
      payload: {
        moduleSlug: 'engage-ai',
        capability: 'post-social',
      },
    });

    const updated = await rejectAction(db, {
      tenantId,
      userId,
      approvalId: approval.id,
      comment: 'Not safe',
    });

    expect(updated.status).toBe('rejected');
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(notifyDecision).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId,
        decision: 'rejected',
      })
    );

    await db.$disconnect();
  });

  it('filters approvals by risk score range', async () => {
    const db = createTenantClient({ tenantId, userId });

    await submitActionApproval(db, {
      tenantId,
      userId,
      source: 'module:growth',
      payload: {
        moduleSlug: 'growth-pulse',
        capability: 'send-email',
        risk: 'low',
      },
    });

    await submitActionApproval(db, {
      tenantId,
      userId,
      source: 'module:finance',
      payload: {
        moduleSlug: 'finance-ops',
        capability: 'sync-ledger',
        impact: 'Global rollup',
      },
    });

    const highRisk = await listActionApprovals(db, { minRisk: 60 });
    expect(highRisk.every((approval) => approval.riskScore >= 60)).toBe(true);

    const lowRisk = await listActionApprovals(db, { maxRisk: 40 });
    expect(lowRisk.every((approval) => approval.riskScore <= 40)).toBe(true);

    await db.$disconnect();
  });

  it('prevents approving actions that are not pending', async () => {
    const db = createTenantClient({ tenantId, userId });

    const { approval } = await submitActionApproval(db, {
      tenantId,
      userId,
      source: 'module:engage',
      payload: {
        moduleSlug: 'engage-ai',
        capability: 'post-social',
      },
    });

    await rejectAction(db, {
      tenantId,
      userId,
      approvalId: approval.id,
    });

    await expect(
      approveAction(db, {
        tenantId,
        userId,
        approvalId: approval.id,
      })
    ).rejects.toBeInstanceOf(ActionApprovalStateError);

    await db.$disconnect();
  });
});
