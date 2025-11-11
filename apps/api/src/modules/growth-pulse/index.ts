import { GrowthPulseCapability, GrowthPulseInputSchema, GrowthPulseOutputSchema } from '@ocsuite/module-sdk';
import type { GrowthPulseInput, GrowthPulseOutput } from '@ocsuite/module-sdk';
import type { PrismaClient } from '@ocsuite/db';
import type { Logger } from 'pino';
import {
  calculateMetrics,
  calculateDefaultScore,
  determineSeverity,
  generateDefaultActions,
  generateDefaultHighlights,
  generateDefaultSummary,
} from './common.js';

interface ExecutionDeps {
  db: PrismaClient;
  logger: Logger;
}

interface ExecutionContext extends ExecutionDeps {
  tenantId: string;
  actorId: string;
}

async function runGrowthPulseCapability(
  input: GrowthPulseInput,
  context: ExecutionContext
): Promise<GrowthPulseOutput> {
  const { db, tenantId, logger } = context;

  const endDate = input.dateRange?.end ? new Date(input.dateRange.end) : new Date();
  const startDate = input.dateRange?.start
    ? new Date(input.dateRange.start)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const snapshots = await db.analyticsSnapshot.findMany({
    where: {
      tenantId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { date: 'asc' },
  });

  if (snapshots.length === 0) {
    logger.warn('No analytics snapshots available for growth pulse capability', {
      tenantId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
    throw new Error('No analytics data available for requested date range');
  }

  const metrics = calculateMetrics(snapshots);
  const severity = determineSeverity(metrics);
  const score = calculateDefaultScore(metrics);
  const summary = generateDefaultSummary(metrics);
  const highlights = generateDefaultHighlights(metrics);
  const actionItems = generateDefaultActions(metrics);

  return {
    severity,
    score,
    summary,
    highlights,
    actionItems: actionItems.map((item) => ({
      title: item.title,
      description: item.description ?? '',
      priority:
        item.priority === 'low' || item.priority === 'medium' || item.priority === 'high'
          ? item.priority
          : 'medium',
      estimatedImpact: item.estimatedImpact ?? 'Monitor performance metrics',
    })),
    metrics: {
      totalRevenue: Number(metrics.totalRevenue.toFixed(2)),
      growthRate: Number(metrics.growthRate.toFixed(2)),
      conversionRate: Number(metrics.conversionRate.toFixed(2)),
      avgRevenuePerUser: Number(metrics.avgRevenuePerUser.toFixed(2)),
    },
  } satisfies GrowthPulseOutput;
}

export function buildGrowthPulseInputs(
  payload: Record<string, unknown>,
  tenantId: string
): GrowthPulseInput {
  const payloadTenantId = typeof payload.tenantId === 'string' ? payload.tenantId : undefined;

  if (payloadTenantId && payloadTenantId !== tenantId) {
    throw new Error('Payload tenantId does not match action approval tenant');
  }

  const normalized: Record<string, unknown> = { ...payload };
  delete normalized.moduleSlug;
  delete normalized.capability;
  delete normalized.undoPayload;
  normalized.tenantId = tenantId;

  return GrowthPulseInputSchema.parse(normalized);
}

export function buildGrowthPulseOutputs(output: GrowthPulseOutput): GrowthPulseOutput {
  return GrowthPulseOutputSchema.parse(output);
}

export function growthPulseExecution(
  payload: Record<string, unknown>,
  deps: ExecutionDeps & { tenantId: string; actorId: string }
): Promise<GrowthPulseOutput> {
  const inputs = buildGrowthPulseInputs(payload, deps.tenantId);
  return runGrowthPulseCapability(inputs, deps);
}

export const growthPulseCapabilityDefinition = GrowthPulseCapability;
