import { createTenantClient, type BillingUsage } from '@ocsuite/db';
import { parseJsonRecord, toInputJson } from '../utils/json.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface BillingUsagePoint {
  date: string;
  tokensUsed: number;
  tasksExecuted: number;
  alertsTriggered: number;
  activeWidgets: number;
  metadata?: Record<string, unknown>;
}

export interface BillingUsageSummary {
  usage: BillingUsagePoint[];
  totals: {
    tokensUsed: number;
    tasksExecuted: number;
    alertsTriggered: number;
    activeWidgets: number;
  };
  range: {
    start: string;
    end: string;
    days: number;
  };
}

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0] ?? date.toISOString();
}

function daysBetween(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.round(diff / DAY_MS) + 1);
}

function mapUsagePoint(record: BillingUsage): BillingUsagePoint {
  const metadata =
    record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? parseJsonRecord(record.metadata)
      : undefined;

  return {
    date: toISODate(record.date),
    tokensUsed: record.tokensUsed,
    tasksExecuted: record.tasksExecuted,
    alertsTriggered: record.alertsTriggered,
    activeWidgets: record.activeWidgets,
    metadata,
  };
}

export function normalizeToDate(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

export async function getBillingUsage(params: {
  tenantId: string;
  startDate: Date;
  endDate: Date;
}): Promise<BillingUsageSummary> {
  const db = createTenantClient({ tenantId: params.tenantId });

  const usage = await db.billingUsage.findMany({
    where: {
      tenantId: params.tenantId,
      date: {
        gte: params.startDate,
        lte: params.endDate,
      },
    },
    orderBy: { date: 'asc' },
  });

  const points = usage.map(mapUsagePoint);

  const totals = points.reduce(
    (acc, point) => {
      acc.tokensUsed += point.tokensUsed;
      acc.tasksExecuted += point.tasksExecuted;
      acc.alertsTriggered += point.alertsTriggered;
      acc.activeWidgets = Math.max(acc.activeWidgets, point.activeWidgets);
      return acc;
    },
    { tokensUsed: 0, tasksExecuted: 0, alertsTriggered: 0, activeWidgets: 0 }
  );

  const start = toISODate(params.startDate);
  const end = toISODate(params.endDate);
  const days = daysBetween(params.startDate, params.endDate);

  return {
    usage: points,
    totals,
    range: {
      start,
      end,
      days,
    },
  };
}

export interface BillingUsageDelta {
  tokensUsed?: number;
  tasksExecuted?: number;
  alertsTriggered?: number;
  activeWidgets?: number;
}

export interface BillingUsageEventMetadata {
  type: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

export async function applyBillingUsageDelta(params: {
  tenantId: string;
  date?: Date;
  deltas?: BillingUsageDelta;
  event?: BillingUsageEventMetadata;
}): Promise<BillingUsagePoint> {
  const targetDate = normalizeToDate(params.date ?? new Date());
  const db = createTenantClient({ tenantId: params.tenantId });

  const existing = await db.billingUsage.findUnique({
    where: {
      tenantId_date: {
        tenantId: params.tenantId,
        date: targetDate,
      },
    },
  });

  const deltas = {
    tokensUsed: params.deltas?.tokensUsed ?? 0,
    tasksExecuted: params.deltas?.tasksExecuted ?? 0,
    alertsTriggered: params.deltas?.alertsTriggered ?? 0,
  };

  const activeWidgets = params.deltas?.activeWidgets;

  let metadata: Record<string, unknown> | undefined;
  if (existing?.metadata && isRecord(existing.metadata)) {
    metadata = parseJsonRecord(existing.metadata);
  }

  if (params.event) {
    const rawEvents = metadata?.events;
    const events: Record<string, unknown>[] = Array.isArray(rawEvents)
      ? rawEvents.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [];
    const occurredAt = params.event.occurredAt ?? new Date().toISOString();
    events.push({
      type: params.event.type,
      occurredAt,
      payload: params.event.payload,
    });
    metadata = {
      ...metadata,
      events,
      lastEventType: params.event.type,
      lastEventAt: occurredAt,
    };
  }

  const record = await db.billingUsage.upsert({
    where: {
      tenantId_date: {
        tenantId: params.tenantId,
        date: targetDate,
      },
    },
    create: {
      tenantId: params.tenantId,
      date: targetDate,
      tokensUsed: deltas.tokensUsed,
      tasksExecuted: deltas.tasksExecuted,
      alertsTriggered: deltas.alertsTriggered,
      activeWidgets: activeWidgets ?? 0,
      metadata: metadata ? toInputJson(metadata) : undefined,
    },
    update: {
      tokensUsed: { increment: deltas.tokensUsed },
      tasksExecuted: { increment: deltas.tasksExecuted },
      alertsTriggered: { increment: deltas.alertsTriggered },
      ...(activeWidgets !== undefined ? { activeWidgets } : {}),
      metadata: metadata ? toInputJson(metadata) : undefined,
    },
  });

  return mapUsagePoint(record);
}
