import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, createTenantClient } from '@ocsuite/db';
import actionsRoutes from '../../src/routes/actions.routes.js';

const mocks = vi.hoisted(() => {
  const enqueueMock = vi.fn(async () => ({
    jobId: `job-${randomUUID()}`,
    queueName: 'action-executor',
    enqueuedAt: new Date().toISOString(),
  }));
  const notifySubmitted = vi.fn().mockResolvedValue(undefined);
  const notifyDecision = vi.fn().mockResolvedValue(undefined);
  return { enqueueMock, notifySubmitted, notifyDecision };
});

vi.mock('../../src/queue/client.js', () => ({
  enqueueActionExecution: mocks.enqueueMock,
}));

vi.mock('../../src/services/notifications.js', () => ({
  notifyActionApprovalSubmitted: mocks.notifySubmitted,
  notifyActionApprovalDecision: mocks.notifyDecision,
  notifyActionExecutionResult: vi.fn().mockResolvedValue(undefined),
}));

const { enqueueMock, notifySubmitted, notifyDecision } = mocks;

const tenantId = `tenant-${randomUUID()}`;
const ownerId = `owner-${randomUUID()}`;
const memberId = `member-${randomUUID()}`;

function buildApp() {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    type MutableRequest = express.Request & {
      auth?: {
        userId: string;
        sessionId: string;
        claims: Record<string, unknown>;
      };
      clerkId?: string;
    };

    const request = req as MutableRequest;
    const mockUser = typeof req.headers['x-mock-user'] === 'string'
      ? req.headers['x-mock-user']
      : ownerId;

    request.auth = {
      userId: mockUser,
      sessionId: 'test-session',
      claims: {},
    };
    request.clerkId = mockUser;
    next();
  });

  app.use('/actions', actionsRoutes);
  return app;
}

async function wipeTenantState() {
  const db = createTenantClient({ tenantId, userId: ownerId });
  try {
    await db.notification.deleteMany();
    await db.task.deleteMany();
    await db.actionApproval.deleteMany();
  } finally {
    await db.$disconnect();
  }
}

describe('Action approval API integration', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = buildApp();

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Integration Test Tenant',
        slug: tenantId,
      },
    });

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          clerkId: ownerId,
          email: `${ownerId}@example.com`,
          name: 'Owner User',
        },
        {
          id: memberId,
          clerkId: memberId,
          email: `${memberId}@example.com`,
          name: 'Member User',
        },
      ],
    });

    await prisma.tenantMember.createMany({
      data: [
        {
          tenantId,
          userId: ownerId,
          role: 'owner',
        },
        {
          tenantId,
          userId: memberId,
          role: 'member',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.actionApproval.deleteMany({ where: { tenantId } });
    await prisma.tenantMember.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  beforeEach(async () => {
    enqueueMock.mockClear();
    notifySubmitted.mockClear();
    notifyDecision.mockClear();
    await wipeTenantState();
  });

  it('submits, approves, and audits an action', async () => {
    const submitResponse = await request(app)
      .post('/actions/submit')
      .set('Authorization', 'Bearer test-token')
      .set('X-Tenant-ID', tenantId)
      .send({
        source: 'module:revops',
        payload: {
          moduleSlug: 'revops-automation',
          capability: 'bulk-update',
          connectors: ['salesforce'],
        },
      });

    expect(submitResponse.status).toBe(201);
    const approvalId = submitResponse.body.approval.id as string;
    expect(notifySubmitted).toHaveBeenCalled();

    const listResponse = await request(app)
      .get('/actions/pending')
      .set('Authorization', 'Bearer test-token')
      .set('X-Tenant-ID', tenantId);

  expect(listResponse.status).toBe(200);
  const pendingIds = listResponse.body.approvals.map((item: { id: string }) => item.id);
  expect(pendingIds).toContain(approvalId);

    const approveResponse = await request(app)
      .post(`/actions/${approvalId}/approve`)
      .set('Authorization', 'Bearer test-token')
      .set('X-Tenant-ID', tenantId)
      .send({ comment: 'Ship it' });

    expect(approveResponse.status).toBe(200);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(notifyDecision).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ decision: 'approved' })
    );

    const auditResponse = await request(app)
      .get(`/actions/${approvalId}/audit`)
      .set('Authorization', 'Bearer test-token')
      .set('X-Tenant-ID', tenantId);

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'submitted' }),
        expect.objectContaining({ event: 'approved' }),
        expect.objectContaining({ event: 'enqueued' }),
      ])
    );
  });

  it('prevents members from viewing audit logs', async () => {
    const submitResponse = await request(app)
      .post('/actions/submit')
      .set('Authorization', 'Bearer test-token')
      .set('X-Tenant-ID', tenantId)
      .send({
        source: 'module:engage',
        payload: {
          moduleSlug: 'engage-ai',
          capability: 'post-update',
        },
      });

    const approvalId = submitResponse.body.approval.id as string;

    const memberAudit = await request(app)
      .get(`/actions/${approvalId}/audit`)
      .set('Authorization', 'Bearer test-token')
      .set('X-Tenant-ID', tenantId)
      .set('X-Mock-User', memberId);

    expect(memberAudit.status).toBe(403);
    expect(memberAudit.body.error).toBe('forbidden');
  });
});
