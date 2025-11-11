import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantTransactionClient } from '../trigger-engine.js';
import { evaluateTenantTriggers } from '../trigger-engine.js';

const { mockNotifyAlertRaised, mockTrackTenantEvent } = vi.hoisted(() => ({
  mockNotifyAlertRaised: vi.fn(),
  mockTrackTenantEvent: vi.fn(),
}));

vi.mock('../notifications.js', () => ({
  notifyAlertRaised: mockNotifyAlertRaised,
}));

vi.mock('../utils/telemetry.js', () => ({
  trackTenantEvent: mockTrackTenantEvent,
}));

vi.mock('../utils/logger.js', () => ({
  createContextLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

type MockDb = ReturnType<typeof createMockDb>;

function createMockDb() {
  return {
    triggerRule: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    },
    alert: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    tenantWidget: {
      count: vi.fn().mockResolvedValue(0),
    },
    usageSnapshot: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    billingUsage: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    analyticsSnapshot: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    moduleInsight: {
      count: vi.fn().mockResolvedValue(0),
    },
    knowledgeEntry: {
      count: vi.fn().mockResolvedValue(0),
    },
    knowledgeSource: {
      count: vi.fn().mockResolvedValue(0),
    },
  } satisfies Record<string, any>;
}

describe('evaluateTenantTriggers', () => {
  let db: MockDb;
  const now = new Date('2025-03-05T10:00:00Z');

  beforeEach(() => {
    db = createMockDb();
    mockNotifyAlertRaised.mockReset();
    mockTrackTenantEvent.mockReset();
  });

  it('fires a scheduled rule and records alert impact', async () => {
    const alertRecord = {
      id: 'alert-123',
      tenantId: 'tenant-1',
      ruleId: 'rule-1',
      type: 'schedule',
      severity: 'warning',
      title: 'Daily health check',
      summary: 'Scheduled rule fired',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    } as const;

    db.triggerRule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-1',
        tenantId: 'tenant-1',
        name: 'Daily health check',
        type: 'schedule',
        schedule: '*/5 * * * *',
        enabled: true,
        severity: 'warning',
        lastRunAt: new Date('2025-03-05T09:55:00Z'),
        lastTriggeredAt: null,
        metric: null,
        threshold: null,
        windowDays: null,
        createdAt: new Date('2025-03-01T00:00:00Z'),
        updatedAt: new Date('2025-03-01T00:00:00Z'),
      } as any,
    ]);
    db.alert.create.mockResolvedValueOnce(alertRecord);
    db.tenantWidget.count.mockResolvedValueOnce(3);

    const triggered = await evaluateTenantTriggers(
      db as unknown as TenantTransactionClient,
      { tenantId: 'tenant-1', now }
    );

    expect(triggered).toBe(1);
    expect(db.triggerRule.update).toHaveBeenCalledTimes(1);
    const updateArgs = db.triggerRule.update.mock.calls[0][0];
    expect(updateArgs).toMatchObject({ where: { id: 'rule-1' } });
    expect(updateArgs.data).toMatchObject({
      lastRunAt: now,
      lastTriggeredAt: now,
    });
    expect(db.alert.create).toHaveBeenCalledTimes(1);
    expect(mockNotifyAlertRaised).toHaveBeenCalledTimes(1);
    const notifyArgs = mockNotifyAlertRaised.mock.calls[0];
    expect(notifyArgs[0]).toBe(db);
    expect(notifyArgs[1]).toMatchObject({
      tenantId: 'tenant-1',
      alert: alertRecord,
    });
    expect(db.usageSnapshot.upsert).toHaveBeenCalledTimes(1);
    const usageArgs = db.usageSnapshot.upsert.mock.calls[0][0];
    expect(usageArgs.create).toMatchObject({
      tenantId: 'tenant-1',
      alertsTriggered: 1,
      activeWidgets: 3,
    });
    expect(usageArgs.create.summary).toMatchObject({
      lastAlert: { id: 'alert-123', severity: 'warning' },
    });

  expect(db.billingUsage.upsert).toHaveBeenCalledTimes(1);
    const billingArgs = db.billingUsage.upsert.mock.calls[0][0];
    expect(billingArgs.create).toMatchObject({
      tenantId: 'tenant-1',
      alertsTriggered: 1,
      activeWidgets: 3,
    });
    expect(billingArgs.create.metadata).toMatchObject({
      lastAlert: { id: 'alert-123', severity: 'warning' },
    });
  });

  it('skips rules with pending alerts', async () => {
    db.triggerRule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-2',
        tenantId: 'tenant-1',
        name: 'Heartbeat',
        type: 'schedule',
        schedule: '*/10 * * * *',
        enabled: true,
        severity: 'warning',
        lastRunAt: new Date('2025-03-05T09:50:00Z'),
        lastTriggeredAt: new Date('2025-03-05T09:40:00Z'),
        metric: null,
        threshold: null,
        windowDays: null,
        createdAt: new Date('2025-03-01T00:00:00Z'),
        updatedAt: new Date('2025-03-01T00:00:00Z'),
      } as any,
    ]);
    db.alert.findFirst.mockResolvedValueOnce({
      id: 'existing-alert',
      status: 'pending',
    });

    const triggered = await evaluateTenantTriggers(
      db as unknown as TenantTransactionClient,
      { tenantId: 'tenant-1', now }
    );

    expect(triggered).toBe(0);
    expect(db.alert.create).not.toHaveBeenCalled();
    expect(mockNotifyAlertRaised).not.toHaveBeenCalled();
    expect(db.usageSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('evaluates metric thresholds using usage snapshots', async () => {
    const alertRecord = {
      id: 'alert-789',
      tenantId: 'tenant-9',
      ruleId: 'rule-metric',
      type: 'metric_threshold',
      severity: 'critical',
      title: 'Token spike',
      summary: 'Threshold crossed',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    } as const;

    db.triggerRule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-metric',
        tenantId: 'tenant-9',
        name: 'Token spike',
        type: 'metric_threshold',
        metric: 'usage.tokens_used',
        threshold: 100,
        enabled: true,
        severity: 'critical',
        schedule: null,
        lastRunAt: null,
        lastTriggeredAt: null,
        windowDays: null,
        createdAt: new Date('2025-03-01T00:00:00Z'),
        updatedAt: new Date('2025-03-01T00:00:00Z'),
      } as any,
    ]);
    db.alert.create.mockResolvedValueOnce(alertRecord);
    db.usageSnapshot.findFirst.mockResolvedValueOnce({
      tokensUsed: 125,
      tasksExecuted: 10,
      alertsTriggered: 2,
    });
    db.tenantWidget.count.mockResolvedValueOnce(5);

    const triggered = await evaluateTenantTriggers(
      db as unknown as TenantTransactionClient,
      { tenantId: 'tenant-9', now }
    );

    expect(triggered).toBe(1);
    expect(db.usageSnapshot.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-9' },
      orderBy: { date: 'desc' },
    });
    expect(db.alert.create).toHaveBeenCalledTimes(1);
    const alertArgs = db.alert.create.mock.calls[0][0];
    expect(alertArgs.data).toMatchObject({
      ruleId: 'rule-metric',
      tenantId: 'tenant-9',
      type: 'metric_threshold',
    });
    expect(db.usageSnapshot.upsert).toHaveBeenCalled();
    expect(db.billingUsage.upsert).toHaveBeenCalled();
  });
});
