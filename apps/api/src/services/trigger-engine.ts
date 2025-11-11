import CronExpressionParser from 'cron-parser';
import type {
  Prisma,
  TriggerRule,
  Alert,
  UsageSnapshot,
  BillingUsage,
} from '@ocsuite/db';
import { TriggerSeverity } from '@ocsuite/db';
import { toInputJson, parseJsonRecord } from '../utils/json.js';
import { notifyAlertRaised } from './notifications.js';
import { trackTenantEvent } from '../utils/telemetry.js';
import { createContextLogger } from '../utils/logger.js';

export type TenantTransactionClient = Prisma.TransactionClient;

interface EvaluationOptions {
  tenantId: string;
  now: Date;
}

interface EvaluationResult {
  triggered: boolean;
  alert?: Alert;
}

const DEFAULT_ANOMALY_THRESHOLD = 2.5;
const MIN_ANOMALY_POINTS = 5;

export async function evaluateTenantTriggers(
  db: TenantTransactionClient,
  options: EvaluationOptions
): Promise<number> {
  const logger = createContextLogger('trigger-engine', {
    tenantId: options.tenantId,
  });

  const rules = await db.triggerRule.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!rules.length) {
    return 0;
  }

  let triggeredCount = 0;

  for (const rule of rules) {
    try {
      const evaluation = await evaluateRule(db, rule, options);
      if (evaluation.triggered) {
        triggeredCount += 1;
        logger.info('Trigger fired', {
          ruleId: rule.id,
          type: rule.type,
          severity: rule.severity,
          alertId: evaluation.alert?.id,
        });
      }

      await db.triggerRule.update({
        where: { id: rule.id },
        data: {
          lastRunAt: options.now,
          lastTriggeredAt: evaluation.triggered ? options.now : rule.lastTriggeredAt,
        },
      });
    } catch (error) {
      logger.error('Failed to evaluate trigger rule', {
        ruleId: rule.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return triggeredCount;
}

async function evaluateRule(
  db: TenantTransactionClient,
  rule: TriggerRule,
  options: EvaluationOptions
): Promise<EvaluationResult> {
  switch (rule.type) {
    case 'schedule':
      return evaluateScheduleRule(db, rule, options);
    case 'metric_threshold':
      return evaluateMetricThresholdRule(db, rule, options);
    case 'anomaly':
      return evaluateAnomalyRule(db, rule, options);
    default:
      return { triggered: false };
  }
}

async function evaluateScheduleRule(
  db: TenantTransactionClient,
  rule: TriggerRule,
  options: EvaluationOptions
): Promise<EvaluationResult> {
  if (!rule.schedule) {
    return { triggered: false };
  }

  const shouldTrigger = shouldRunCron(rule.schedule, rule.lastRunAt, options.now);

  if (!shouldTrigger) {
    return { triggered: false };
  }

  const hasOpenAlert = await hasPendingAlert(db, rule.id);
  if (hasOpenAlert) {
    return { triggered: false };
  }

  const alert = await createAlert(db, rule, {
    title: rule.name,
    summary: `Scheduled rule "${rule.name}" executed at ${options.now.toISOString()}`,
    payload: {
      schedule: rule.schedule,
      triggeredAt: options.now.toISOString(),
      ruleId: rule.id,
      ruleType: rule.type,
    },
  });

  await finalizeAlert(db, rule.tenantId, alert);

  return { triggered: true, alert };
}

async function evaluateMetricThresholdRule(
  db: TenantTransactionClient,
  rule: TriggerRule,
  options: EvaluationOptions
): Promise<EvaluationResult> {
  if (!rule.metric || rule.threshold === null || typeof rule.threshold === 'undefined') {
    return { triggered: false };
  }

  const metricValue = await resolveMetricValue(db, rule.metric, options);

  if (metricValue === null) {
    return { triggered: false };
  }

  if (metricValue < rule.threshold) {
    return { triggered: false };
  }

  const hasOpenAlert = await hasPendingAlert(db, rule.id);
  if (hasOpenAlert) {
    return { triggered: false };
  }

  const alert = await createAlert(db, rule, {
    title: rule.name,
    summary: `Metric ${rule.metric} reached ${metricValue.toLocaleString()} (threshold ${rule.threshold.toLocaleString()})`,
    payload: {
      metric: rule.metric,
      threshold: rule.threshold,
      observed: metricValue,
      ruleId: rule.id,
      ruleType: rule.type,
    },
  });

  await finalizeAlert(db, rule.tenantId, alert);

  return { triggered: true, alert };
}

async function evaluateAnomalyRule(
  db: TenantTransactionClient,
  rule: TriggerRule,
  options: EvaluationOptions
): Promise<EvaluationResult> {
  if (!rule.metric) {
    return { triggered: false };
  }

  const windowDays = rule.windowDays && rule.windowDays > 0 ? rule.windowDays : 14;
  const dataSeries = await resolveMetricSeries(db, rule.metric, windowDays, options);

  if (dataSeries.length < MIN_ANOMALY_POINTS) {
    return { triggered: false };
  }

  const latest = dataSeries.at(-1);

  if (latest === undefined) {
    return { triggered: false };
  }
  const mean = average(dataSeries);
  const stdDeviation = standardDeviation(dataSeries, mean);

  if (stdDeviation === 0) {
    return { triggered: false };
  }

  const zScore = Math.abs((latest - mean) / stdDeviation);
  const threshold = rule.threshold ?? DEFAULT_ANOMALY_THRESHOLD;

  if (zScore < threshold) {
    return { triggered: false };
  }

  const hasOpenAlert = await hasPendingAlert(db, rule.id);
  if (hasOpenAlert) {
    return { triggered: false };
  }

  const alert = await createAlert(db, rule, {
    title: rule.name,
    summary: `Anomaly detected for ${rule.metric}: z-score ${zScore.toFixed(2)} (threshold ${threshold})`,
    payload: {
      metric: rule.metric,
      zScore,
      mean,
      stdDeviation,
      latest,
      threshold,
      ruleId: rule.id,
      ruleType: rule.type,
    },
  });

  await finalizeAlert(db, rule.tenantId, alert);

  return { triggered: true, alert };
}

function shouldRunCron(cronExpr: string, lastRunAt: Date | null, now: Date): boolean {
  try {
  const interval = CronExpressionParser.parse(cronExpr, {
      currentDate: lastRunAt ?? new Date(now.getTime() - 60_000),
      tz: 'UTC',
    });

    const next = interval.next();
    return next.getTime() <= now.getTime();
  } catch {
    return false;
  }
}

async function hasPendingAlert(db: TenantTransactionClient, ruleId: string): Promise<boolean> {
  const existing = await db.alert.findFirst({
    where: {
      ruleId,
      status: { in: ['pending', 'snoozed'] },
    },
  });
  return Boolean(existing);
}

interface AlertDetails {
  title?: string;
  summary?: string;
  payload?: Record<string, unknown>;
}

async function createAlert(
  db: TenantTransactionClient,
  rule: TriggerRule,
  details: AlertDetails
): Promise<Alert> {
  return db.alert.create({
    data: {
      tenantId: rule.tenantId,
      ruleId: rule.id,
      type: rule.type,
      severity: rule.severity ?? TriggerSeverity.warning,
      title: details.title ?? rule.name,
      summary: details.summary ?? `Trigger rule "${rule.name}" fired`,
      payload: details.payload ? toInputJson(details.payload) : undefined,
    },
  });
}

async function finalizeAlert(
  db: TenantTransactionClient,
  tenantId: string,
  alert: Alert
): Promise<void> {
  await notifyAlertRaised(db, {
      tenantId,
      alert,
  });

  await trackTenantEvent({
    tenantId,
    event: 'alert.triggered',
    properties: {
      alertId: alert.id,
      ruleId: alert.ruleId,
      severity: alert.severity,
      type: alert.type,
    },
  });

  await recordAlertImpact(db, tenantId, alert);
}

async function recordAlertImpact(
  db: TenantTransactionClient,
  tenantId: string,
  alert: Alert
): Promise<void> {
  const now = alert.createdAt ?? new Date();
  const day = startOfDay(now);

  const widgetCount = await db.tenantWidget.count({
    where: { tenantId },
  });

  const existingSnapshot = await db.usageSnapshot.findUnique({
    where: {
      tenantId_date: {
        tenantId,
        date: day,
      },
    },
  });

  const existingSummary = (existingSnapshot as UsageSnapshot | null)?.summary;

  const summary = mergeSummary(existingSummary, {
    lastAlert: {
      id: alert.id,
      severity: alert.severity,
      type: alert.type,
      title: alert.title,
      summary: alert.summary,
      createdAt: alert.createdAt,
    },
  });

  await db.usageSnapshot.upsert({
    where: {
      tenantId_date: {
        tenantId,
        date: day,
      },
    },
    create: {
      tenantId,
      date: day,
      alertsTriggered: 1,
      activeWidgets: widgetCount,
  summary: toInputJson(summary),
    },
    update: {
      alertsTriggered: { increment: 1 },
      activeWidgets: widgetCount,
      summary: toInputJson(summary),
    },
  });

  const existingUsage = await db.billingUsage.findUnique({
    where: {
      tenantId_date: {
        tenantId,
        date: day,
      },
    },
  });

  const existingMetadata = (existingUsage as BillingUsage | null)?.metadata;

  const usageMetadata = mergeSummary(existingMetadata, {
    lastAlert: {
      id: alert.id,
      severity: alert.severity,
      type: alert.type,
      createdAt: alert.createdAt,
    },
  });

  await db.billingUsage.upsert({
    where: {
      tenantId_date: {
        tenantId,
        date: day,
      },
    },
    create: {
      tenantId,
      date: day,
      alertsTriggered: 1,
      activeWidgets: widgetCount,
  metadata: toInputJson(usageMetadata),
    },
    update: {
      alertsTriggered: { increment: 1 },
      activeWidgets: widgetCount,
  metadata: toInputJson(usageMetadata),
    },
  });
}

async function resolveMetricValue(
  db: TenantTransactionClient,
  metricKey: string,
  options: EvaluationOptions
): Promise<number | null> {
  const [category, field] = metricKey.split('.');

  switch (category) {
    case 'usage': {
      const snapshot = await db.usageSnapshot.findFirst({
        where: { tenantId: options.tenantId },
        orderBy: { date: 'desc' },
      });

      if (!snapshot) return 0;

      if (field === 'tokens_used') return snapshot.tokensUsed;
      if (field === 'tasks_executed') return snapshot.tasksExecuted;
      if (field === 'alerts_triggered') {
        return (snapshot as UsageSnapshot).alertsTriggered;
      }
      return null;
    }
    case 'analytics': {
      const snapshot = await db.analyticsSnapshot.findFirst({
        where: { tenantId: options.tenantId },
        orderBy: { date: 'desc' },
        select: {
          sessions: true,
          conversions: true,
          revenue: true,
        },
      });
      if (!snapshot) return 0;
      if (field === 'sessions') return snapshot.sessions;
      if (field === 'conversions') return snapshot.conversions;
      if (field === 'revenue') return snapshot.revenue;
      return null;
    }
    case 'insights': {
      if (field === 'count') {
        const since = new Date(options.now.getTime() - 24 * 60 * 60 * 1000);
        return await db.moduleInsight.count({
          where: {
            tenantId: options.tenantId,
            createdAt: { gte: since },
          },
        });
      }
      return null;
    }
    case 'knowledge': {
      if (field === 'entries') {
        return await db.knowledgeEntry.count({
          where: {
            OR: [
              { tenantId: options.tenantId },
              { tenantId: null },
            ],
          },
        });
      }
      if (field === 'sources') {
        return await db.knowledgeSource.count({
          where: {
            OR: [
              { tenantId: options.tenantId },
              { tenantId: null },
            ],
          },
        });
      }
      return null;
    }
    default:
      return null;
  }
}

async function resolveMetricSeries(
  db: TenantTransactionClient,
  metricKey: string,
  windowDays: number,
  options: EvaluationOptions
): Promise<number[]> {
  const [category, field] = metricKey.split('.');
  const startDate = new Date(options.now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  switch (category) {
    case 'usage': {
      const snapshots = await db.usageSnapshot.findMany({
        where: {
          tenantId: options.tenantId,
          date: { gte: startDate },
        },
        orderBy: { date: 'asc' },
      });
      return snapshots.map((snapshot) => {
        if (field === 'tokens_used') return snapshot.tokensUsed;
        if (field === 'tasks_executed') return snapshot.tasksExecuted;
        if (field === 'alerts_triggered') {
          return (snapshot as UsageSnapshot).alertsTriggered;
        }
        return 0;
      });
    }
    case 'analytics': {
      const snapshots = await db.analyticsSnapshot.findMany({
        where: {
          tenantId: options.tenantId,
          date: { gte: startDate },
        },
        orderBy: { date: 'asc' },
        select: {
          sessions: true,
          conversions: true,
          revenue: true,
        },
      });
      return snapshots.map((snapshot) => {
        if (field === 'sessions') return snapshot.sessions;
        if (field === 'conversions') return snapshot.conversions;
        if (field === 'revenue') return snapshot.revenue;
        return 0;
      });
    }
    default:
      return [];
  }
}

function mergeSummary(existing: Prisma.JsonValue | null | undefined, patch: Record<string, unknown>) {
  const current = parseJsonRecord(existing ?? {});
  return {
    ...current,
    ...patch,
  } satisfies Record<string, unknown>;
}

function startOfDay(date: Date): Date {
  const cloned = new Date(date);
  cloned.setUTCHours(0, 0, 0, 0);
  return cloned;
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length <= 1) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}
