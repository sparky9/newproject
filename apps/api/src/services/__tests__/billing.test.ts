import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBillingUsageDelta, normalizeToDate } from '../billing.js';

const { mockFindUnique, mockUpsert, mockCreateTenantClient } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockCreateTenantClient: vi.fn(),
}));

interface BillingUpsertArgs {
  where: {
    tenantId_date: {
      tenantId: string;
      date: Date;
    };
  };
  create: {
    tenantId: string;
    date: Date;
    tokensUsed: number;
    tasksExecuted: number;
    alertsTriggered: number;
    activeWidgets: number;
    metadata?: Record<string, unknown>;
  };
  update: Record<string, unknown>;
}

vi.mock('@ocsuite/db', () => ({
  createTenantClient: mockCreateTenantClient,
}));

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockCreateTenantClient.mockReset();

  mockFindUnique.mockResolvedValue(null);
  mockCreateTenantClient.mockReturnValue({
    billingUsage: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  });
});

describe('applyBillingUsageDelta', () => {
  it('creates a new usage entry when no record exists', async () => {
    const tenantId = 'tenant-123';
    const requestDate = new Date('2025-02-01T15:30:00Z');
    const normalizedDate = normalizeToDate(requestDate);

    const storedRecord = {
      tenantId,
      date: normalizedDate,
      tokensUsed: 25,
      tasksExecuted: 3,
      alertsTriggered: 1,
      activeWidgets: 5,
      metadata: {
        events: [
          {
            type: 'billing.usage.incremented',
            occurredAt: '2025-02-01T15:30:00.000Z',
            payload: { source: 'stripe' },
          },
        ],
        lastEventType: 'billing.usage.incremented',
        lastEventAt: '2025-02-01T15:30:00.000Z',
      },
    };

  mockUpsert.mockImplementationOnce(async (args: BillingUpsertArgs) => {
      expect(args.where.tenantId_date).toEqual({ tenantId, date: normalizedDate });
      expect(args.create).toMatchObject({
        tenantId,
        date: normalizedDate,
        tokensUsed: 25,
        tasksExecuted: 3,
        alertsTriggered: 1,
        activeWidgets: 5,
      });
      expect(args.create.metadata).toMatchObject({
        events: [
          {
            type: 'billing.usage.incremented',
            occurredAt: '2025-02-01T15:30:00.000Z',
            payload: { source: 'stripe' },
          },
        ],
        lastEventType: 'billing.usage.incremented',
        lastEventAt: '2025-02-01T15:30:00.000Z',
      });
      return storedRecord;
    });

    const result = await applyBillingUsageDelta({
      tenantId,
      date: requestDate,
      deltas: {
        tokensUsed: 25,
        tasksExecuted: 3,
        alertsTriggered: 1,
        activeWidgets: 5,
      },
      event: {
        type: 'billing.usage.incremented',
        occurredAt: '2025-02-01T15:30:00.000Z',
        payload: { source: 'stripe' },
      },
    });

    expect(mockCreateTenantClient).toHaveBeenCalledWith({ tenantId });
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        tenantId_date: { tenantId, date: normalizedDate },
      },
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const expectedDate = normalizedDate.toISOString().split('T')[0] ?? normalizedDate.toISOString();

    expect(result).toEqual({
      date: expectedDate,
      tokensUsed: 25,
      tasksExecuted: 3,
      alertsTriggered: 1,
      activeWidgets: 5,
      metadata: storedRecord.metadata,
    });
  });

  it('increments existing usage and appends event metadata', async () => {
    const tenantId = 'tenant-456';
    const requestDate = new Date('2025-02-02T02:45:00Z');
    const normalizedDate = normalizeToDate(requestDate);

    mockFindUnique.mockResolvedValueOnce({
      tenantId,
      date: normalizedDate,
      tokensUsed: 10,
      tasksExecuted: 4,
      alertsTriggered: 2,
      activeWidgets: 3,
      metadata: {
        events: [
          { type: 'existing-event', occurredAt: '2025-02-01T00:00:00.000Z' },
        ],
        lastEventType: 'existing-event',
        lastEventAt: '2025-02-01T00:00:00.000Z',
      },
    });

    const storedRecord = {
      tenantId,
      date: normalizedDate,
      tokensUsed: 12,
      tasksExecuted: 5,
      alertsTriggered: 3,
      activeWidgets: 3,
      metadata: {
        events: [
          { type: 'existing-event', occurredAt: '2025-02-01T00:00:00.000Z' },
          {
            type: 'billing.usage.daily_rollup',
            occurredAt: '2025-02-02T00:00:00.000Z',
            payload: { points: 2 },
          },
        ],
        lastEventType: 'billing.usage.daily_rollup',
        lastEventAt: '2025-02-02T00:00:00.000Z',
      },
    };

  mockUpsert.mockImplementationOnce(async (args: BillingUpsertArgs) => {
      expect(args.update).toMatchObject({
        tokensUsed: { increment: 2 },
        tasksExecuted: { increment: 1 },
        alertsTriggered: { increment: 1 },
      });
      expect(args.update).not.toHaveProperty('activeWidgets');
      expect(args.update.metadata).toMatchObject({
        events: [
          { type: 'existing-event' },
          { type: 'billing.usage.daily_rollup', payload: { points: 2 } },
        ],
        lastEventType: 'billing.usage.daily_rollup',
        lastEventAt: '2025-02-02T00:00:00.000Z',
      });
      return storedRecord;
    });

    const result = await applyBillingUsageDelta({
      tenantId,
      date: requestDate,
      deltas: {
        tokensUsed: 2,
        tasksExecuted: 1,
        alertsTriggered: 1,
      },
      event: {
        type: 'billing.usage.daily_rollup',
        occurredAt: '2025-02-02T00:00:00.000Z',
        payload: { points: 2 },
      },
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const expectedDate = normalizedDate.toISOString().split('T')[0] ?? normalizedDate.toISOString();

    expect(result).toEqual({
      date: expectedDate,
      tokensUsed: 12,
      tasksExecuted: 5,
      alertsTriggered: 3,
      activeWidgets: 3,
      metadata: storedRecord.metadata,
    });
  });
});
