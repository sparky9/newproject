import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, createTenantClient } from '@ocsuite/db';

import marketplaceRoutes from '../../src/routes/marketplace.routes.js';
import { config } from '../../src/config/index.js';
import {
  TEST_TENANT_ID,
  TEST_USER_ID,
  cleanupTestData,
  createTestTenant,
  createTestUser,
} from '../utils/test-helpers.js';
import { registerWidget } from '../../src/services/marketplace.js';

const ADMIN_KEY = 'test-admin-key';

describe('Marketplace API', () => {
  let app: express.Application;
  const originalAdminKey = config.internalAdminApiKey;

  beforeAll(async () => {
    config.internalAdminApiKey = ADMIN_KEY;

    await createTestTenant(TEST_TENANT_ID);
    await createTestUser(TEST_TENANT_ID, TEST_USER_ID);

    app = express();
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
      request.auth = {
        userId: TEST_USER_ID,
        sessionId: 'test-session-id',
        claims: {},
      };
      request.clerkId = TEST_USER_ID;
      next();
    });

    app.use('/marketplace', marketplaceRoutes);
  });

  afterAll(async () => {
    config.internalAdminApiKey = originalAdminKey;
    await cleanupTestData(TEST_TENANT_ID, TEST_USER_ID);
  });

  beforeEach(async () => {
    const tenantDb = createTenantClient({ tenantId: TEST_TENANT_ID, userId: 'system' });
    try {
      await tenantDb.tenantWidget.deleteMany();
      await tenantDb.triggerRule.deleteMany();
      await tenantDb.alert.deleteMany();
      await tenantDb.billingUsage.deleteMany();
      await tenantDb.usageSnapshot.deleteMany();
    } finally {
      await tenantDb.$disconnect();
    }

    await prisma.widget.deleteMany({
      where: {
        slug: {
          startsWith: 'test-marketplace-',
        },
      },
    });
  });

  it('registers a widget when the internal admin key is provided', async () => {
    const slug = `test-marketplace-${randomUUID()}`;

    const response = await request(app)
      .post('/marketplace/widgets')
      .set('x-internal-api-key', ADMIN_KEY)
      .send({
        slug,
        name: 'Test Widget',
        description: 'Registered via integration test',
        category: 'testing',
        requiredCapabilities: ['analytics:test'],
        dashboard: {
          tile: {
            title: 'Test Tile',
            description: 'Shows test data',
          },
          tags: ['testing'],
        },
        metadata: {
          sample: true,
        },
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      created: true,
      widget: {
        slug,
        name: 'Test Widget',
        description: 'Registered via integration test',
        category: 'testing',
      },
    });

    const stored = await prisma.widget.findUnique({ where: { slug } });
    expect(stored).toBeTruthy();
  });

  it('installs, lists, and uninstalls a widget for a tenant', async () => {
    const slug = `test-marketplace-${randomUUID()}`;

    await registerWidget({
      slug,
      name: 'Marketplace Flow Widget',
      description: 'Validates install flow',
      category: 'testing',
      requiredCapabilities: ['alerts:test'],
      dashboard: {
        tile: {
          title: 'Marketplace Flow Widget',
        },
      },
      metadata: {
        seeded: 'integration-test',
      },
    });

    const listBefore = await request(app)
      .get('/marketplace/widgets')
      .set('X-Tenant-ID', TEST_TENANT_ID)
      .set('Authorization', 'Bearer test-token');

    expect(listBefore.status).toBe(200);
    const beforeEntry = listBefore.body.widgets.find((widget: any) => widget.slug === slug);
    expect(beforeEntry).toBeTruthy();
    expect(beforeEntry.installed).toBe(false);

    const installResponse = await request(app)
      .post(`/marketplace/widgets/${slug}/install`)
      .set('X-Tenant-ID', TEST_TENANT_ID)
      .set('Authorization', 'Bearer test-token')
      .send({
        settings: {
          autoRefresh: true,
        },
      });

    expect(installResponse.status).toBe(200);
    expect(installResponse.body.widget).toMatchObject({
      slug,
      installed: true,
      settings: {
        autoRefresh: true,
      },
    });

    const listAfterInstall = await request(app)
      .get('/marketplace/widgets')
      .set('X-Tenant-ID', TEST_TENANT_ID)
      .set('Authorization', 'Bearer test-token');

    expect(listAfterInstall.status).toBe(200);
    const afterEntry = listAfterInstall.body.widgets.find((widget: any) => widget.slug === slug);
    expect(afterEntry).toBeTruthy();
    expect(afterEntry.installed).toBe(true);
    expect(afterEntry.settings).toEqual({ autoRefresh: true });

    const deleteResponse = await request(app)
      .delete(`/marketplace/widgets/${slug}/install`)
      .set('X-Tenant-ID', TEST_TENANT_ID)
      .set('Authorization', 'Bearer test-token');

    expect(deleteResponse.status).toBe(204);

    const listAfterDelete = await request(app)
      .get('/marketplace/widgets')
      .set('X-Tenant-ID', TEST_TENANT_ID)
      .set('Authorization', 'Bearer test-token');

    expect(listAfterDelete.status).toBe(200);
    const finalEntry = listAfterDelete.body.widgets.find((widget: any) => widget.slug === slug);
    expect(finalEntry).toBeTruthy();
    expect(finalEntry.installed).toBe(false);
  });
});
