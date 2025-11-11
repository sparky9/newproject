import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

import { config } from '../../src/config/index.js';
import billingRoutes from '../../src/routes/billing.routes.js';

const { applyBillingUsageDeltaMock } = vi.hoisted(() => ({
  applyBillingUsageDeltaMock: vi.fn(),
}));

vi.mock('../../src/services/billing.js', () => ({
  getBillingUsage: vi.fn(),
  normalizeToDate: (date: Date) => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  },
  applyBillingUsageDelta: applyBillingUsageDeltaMock,
}));

function createTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use('/billing', billingRoutes);
  return app;
}

describe('POST /billing/webhook', () => {
  beforeEach(() => {
    applyBillingUsageDeltaMock.mockReset();
    config.stripe.webhookSecret = null;
  });

  it('accepts a valid webhook event and forwards usage deltas', async () => {
    applyBillingUsageDeltaMock.mockResolvedValue({
      date: '2025-02-01',
      tokensUsed: 10,
      tasksExecuted: 2,
      alertsTriggered: 1,
      activeWidgets: 4,
      metadata: {
        lastEventType: 'billing.usage.incremented',
      },
    });

    const createdAtSeconds = Math.floor(new Date('2024-11-05T00:00:00.000Z').getTime() / 1000);
    const expectedOccurredAt = new Date(createdAtSeconds * 1000).toISOString();

    const payload = {
      type: 'billing.usage.incremented',
      id: 'evt_123',
      created: createdAtSeconds,
      data: {
        tenantId: 'tenant-abc',
        usage: {
          tokensUsed: 10,
          tasksExecuted: 2,
          alertsTriggered: 1,
          activeWidgets: 4,
        },
        metadata: {
          invoiceId: 'inv_001',
        },
      },
    };

    const response = await request(createTestApp()).post('/billing/webhook').send(payload);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'processed' });
    expect(applyBillingUsageDeltaMock).toHaveBeenCalledTimes(1);
    expect(applyBillingUsageDeltaMock).toHaveBeenCalledWith({
      tenantId: 'tenant-abc',
      deltas: {
        tokensUsed: 10,
        tasksExecuted: 2,
        alertsTriggered: 1,
        activeWidgets: 4,
      },
      event: {
        type: 'billing.usage.incremented',
        occurredAt: expectedOccurredAt,
        payload: {
          invoiceId: 'inv_001',
        },
      },
    });
  });

  it('ignores payloads that do not specify a tenant identifier', async () => {
    const payload = {
      type: 'billing.usage.incremented',
      id: 'evt_999',
      data: {
        usage: {
          tokensUsed: 5,
        },
      },
    };

    const response = await request(createTestApp()).post('/billing/webhook').send(payload);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'ignored' });
    expect(applyBillingUsageDeltaMock).not.toHaveBeenCalled();
  });

  it('rejects requests when a webhook secret is configured and signatures do not match', async () => {
    config.stripe.webhookSecret = 'expected-secret';

    const payload = {
      type: 'billing.usage.incremented',
      data: {
        tenantId: 'tenant-abc',
      },
    };

    const response = await request(createTestApp())
      .post('/billing/webhook')
      .set('stripe-signature', 'invalid-secret')
      .send(payload);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'unauthorized',
      message: 'Invalid webhook signature',
    });
    expect(applyBillingUsageDeltaMock).not.toHaveBeenCalled();
  });
});
