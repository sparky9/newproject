import express from 'express';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { prisma, createTenantClient } from '@ocsuite/db';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async () => ({
    sub: 'mock-user',
    sid: 'mock-session',
  })),
}));

import notificationsRoutes from '../../src/routes/notifications.routes.js';

const TEST_CLERK_ID = 'notifications-user-00000000-0000-0000-0000-000000000001';

describe('Notifications API', () => {
  let app: express.Application;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      type MutableRequest = express.Request & {
        clerkId?: string;
        auth?: {
          userId: string;
          sessionId: string;
          claims: Record<string, unknown>;
        };
      };

      const request = req as MutableRequest;
      request.auth = {
        userId: TEST_CLERK_ID,
        sessionId: 'test-session-id',
        claims: {},
      };
      request.clerkId = TEST_CLERK_ID;
      next();
    });
    app.use('/notifications', notificationsRoutes);

  tenantId = `tenant-${randomUUID()}`;
  userId = TEST_CLERK_ID;

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Notifications Test Tenant',
        slug: `notifications-test-${randomUUID()}`,
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        clerkId: TEST_CLERK_ID,
        email: `notifications-test-${randomUUID()}@example.com`,
        name: 'Notifications Tester',
      },
    });

    await prisma.tenantMember.create({
      data: {
        tenantId,
        userId,
        role: 'owner',
      },
    });
  });

  beforeEach(async () => {
    const tenantDb = createTenantClient({ tenantId, userId });
    try {
      await tenantDb.notification.deleteMany();
      await tenantDb.notificationPreference.deleteMany();
    } finally {
      await tenantDb.$disconnect();
    }
  });

  afterAll(async () => {
    const tenantDb = createTenantClient({ tenantId, userId });
    try {
      await tenantDb.notification.deleteMany();
      await tenantDb.notificationPreference.deleteMany();
    } finally {
      await tenantDb.$disconnect();
    }
    await prisma.tenantMember.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('returns aggregate stats for notifications', async () => {
    const now = new Date();

    const firstId = randomUUID();
    const secondId = randomUUID();
    const thirdId = randomUUID();

    const tenantDb = createTenantClient({ tenantId, userId });
    try {
      await tenantDb.notification.createMany({
        data: [
          {
            id: firstId,
            tenantId,
            userId,
            type: 'action-approval.submitted',
            payload: { approvalId: 'approval-1' },
            channel: 'in_app',
            createdAt: new Date(now.getTime() - 1000 * 60 * 15),
          },
          {
            id: secondId,
            tenantId,
            userId,
            type: 'action-approval.approved',
            payload: { approvalId: 'approval-2' },
            channel: 'in_app',
            readAt: new Date(now.getTime() - 1000 * 60 * 5),
            createdAt: new Date(now.getTime() - 1000 * 60 * 5),
          },
          {
            id: thirdId,
            tenantId,
            userId,
            type: 'action-approval.executed',
            payload: { approvalId: 'approval-3' },
            channel: 'in_app',
            createdAt: now,
          },
        ],
      });
    } finally {
      await tenantDb.$disconnect();
    }

    const response = await request(app)
      .get('/notifications/stats')
      .set('Authorization', 'Bearer test-token')
      .set('X-Tenant-ID', tenantId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 3,
      unread: 2,
      latest: {
        id: thirdId,
        createdAt: expect.any(String),
        readAt: null,
      },
    });

  const latestCreatedAt = new Date(response.body.latest.createdAt).getTime();
  expect(Math.abs(latestCreatedAt - now.getTime())).toBeLessThan(1000);
  });

  it('returns zero counts when no notifications exist', async () => {
    const response = await request(app)
      .get('/notifications/stats')
      .set('Authorization', 'Bearer test-token')
      .set('X-Tenant-ID', tenantId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 0,
      unread: 0,
      latest: null,
    });
  });
});
