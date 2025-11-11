#!/usr/bin/env tsx
import { randomUUID } from 'node:crypto';
import {
  prisma,
  withTenantContext,
  TriggerRuleType,
  TriggerSeverity,
  AlertStatus,
  type Tenant,
} from '@ocsuite/db';
import { registerWidget, installWidgetForTenant } from '../services/marketplace.js';
import { toInputJson } from '../utils/json.js';
import { normalizeToDate } from '../services/billing.js';

const DAY_MS = 86_400_000;

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .trim();
  return slug.length > 0 ? slug : `slice6-${randomUUID().slice(0, 8)}`;
}

async function ensureTenant(options: {
  tenantId: string;
  tenantName: string;
  tenantSlug?: string;
}): Promise<Tenant> {
  const existing = await prisma.tenant.findUnique({ where: { id: options.tenantId } });
  if (existing) {
    return existing;
  }

  const baseSlug = options.tenantSlug ? slugify(options.tenantSlug) : slugify(options.tenantName);
  let candidate = baseSlug;
  let counter = 1;
  let slugExists = await prisma.tenant.findUnique({ where: { slug: candidate } });

  while (slugExists) {
    candidate = `${baseSlug}-${counter}`;
    counter += 1;
    slugExists = await prisma.tenant.findUnique({ where: { slug: candidate } });
  }

  return prisma.tenant.create({
    data: {
      id: options.tenantId,
      name: options.tenantName,
      slug: candidate,
    },
  });
}

async function seedMarketplace(tenantId: string) {
  const widgetRegistration = {
    slug: 'revenue-radar',
    name: 'Revenue Radar',
    description: 'Highlights weekly revenue momentum shifts across inbound and expansion motions.',
    category: 'growth',
    requiredCapabilities: ['analytics:revenue', 'actions:approvals'],
    dashboard: {
      tile: {
        title: 'Revenue Radar',
        description: 'Week-over-week pipeline delta and forecast calls to action.',
        href: '/dashboard/marketplace/revenue-radar',
        variant: 'highlight',
      },
      tags: ['finance', 'forecast'],
    },
    metadata: {
      curated: true,
      beta: true,
    },
  };

  const { widget, created } = await registerWidget(widgetRegistration);
  await installWidgetForTenant({
    tenantId,
    widgetSlug: widget.slug,
    settings: {
      autoRefresh: true,
      notifyOnAnomalies: true,
    },
  });

  return { widget, created };
}

interface SeedTrigger {
  id: string;
  name: string;
  type: TriggerRuleType;
  schedule?: string;
  metric?: string;
  threshold?: number;
  severity: TriggerSeverity;
  config?: Record<string, unknown>;
  windowDays?: number;
}

interface SeedAlert {
  id: string;
  ruleId: string;
  type: TriggerRuleType;
  severity: TriggerSeverity;
  status: AlertStatus;
  title: string;
  summary: string;
  createdAt: Date;
  payload: Record<string, unknown>;
  acknowledgedAt?: Date;
}

async function seedTriggersAndAlerts(tenantId: string) {
  const now = new Date();

  await withTenantContext(prisma, tenantId, async (tx) => {
    const triggers: SeedTrigger[] = [
      {
        id: 'slice6-weekly-briefing',
        name: 'Weekly Executive Briefing',
        type: TriggerRuleType.schedule,
        schedule: '0 13 * * 1',
        severity: TriggerSeverity.info,
        config: {
          cadence: 'weekly',
          audience: 'executive-team',
        },
      },
      {
        id: 'slice6-mql-spike',
        name: 'Marketing Qualified Lead Spike',
        type: TriggerRuleType.metric_threshold,
        metric: 'analytics.mql.delta',
        threshold: 25,
        severity: TriggerSeverity.warning,
        config: {
          comparisonWindowDays: 7,
        },
      },
      {
        id: 'slice6-csat-anomaly',
        name: 'Support CSAT Anomaly',
        type: TriggerRuleType.anomaly,
        metric: 'support.csat.score',
        threshold: 2.8,
        severity: TriggerSeverity.critical,
        config: {
          windowDays: 14,
        },
        windowDays: 14,
      },
    ];

    for (const trigger of triggers) {
      await tx.triggerRule.upsert({
        where: { id: trigger.id },
        update: {
          name: trigger.name,
          type: trigger.type,
          schedule: trigger.schedule ?? null,
          metric: trigger.metric ?? null,
          threshold: trigger.threshold ?? null,
          windowDays: trigger.windowDays ?? null,
          severity: trigger.severity,
          enabled: true,
          config: trigger.config ? toInputJson(trigger.config) : undefined,
        },
        create: {
          id: trigger.id,
          tenantId,
          name: trigger.name,
          type: trigger.type,
          schedule: trigger.schedule ?? null,
          metric: trigger.metric ?? null,
          threshold: trigger.threshold ?? null,
          windowDays: trigger.windowDays ?? null,
          severity: trigger.severity,
          enabled: true,
          config: trigger.config ? toInputJson(trigger.config) : undefined,
        },
      });
    }

    const alerts: SeedAlert[] = [
      {
        id: 'slice6-alert-weekly-digest',
        ruleId: 'slice6-weekly-briefing',
        type: TriggerRuleType.schedule,
        severity: TriggerSeverity.info,
        status: AlertStatus.pending,
        title: 'Weekly briefing ready',
        summary: 'Fresh executive insights have been generated for review.',
        createdAt: new Date(now.getTime() - DAY_MS),
        payload: {
          cadence: 'weekly',
          generatedAt: normalizeToDate(new Date(now.getTime() - DAY_MS)).toISOString(),
        },
      },
      {
        id: 'slice6-alert-mql-spike',
        ruleId: 'slice6-mql-spike',
        type: TriggerRuleType.metric_threshold,
        severity: TriggerSeverity.warning,
        status: AlertStatus.acknowledged,
        title: 'MQL volume up 32% week-over-week',
        summary: 'Triggered follow-up tasks for growth squad review.',
        createdAt: new Date(now.getTime() - 2 * DAY_MS),
        acknowledgedAt: new Date(now.getTime() - DAY_MS / 2),
        payload: {
          metric: 'analytics.mql.delta',
          observed: 32,
          threshold: 25,
        },
      },
    ];

    for (const alert of alerts) {
      await tx.alert.upsert({
        where: { id: alert.id },
        update: {
          ruleId: alert.ruleId,
          type: alert.type,
          severity: alert.severity,
          status: alert.status,
          title: alert.title,
          summary: alert.summary,
          payload: toInputJson(alert.payload),
          acknowledgedAt: alert.acknowledgedAt ?? null,
        },
        create: {
          id: alert.id,
          tenantId,
          ruleId: alert.ruleId,
          type: alert.type,
          severity: alert.severity,
          status: alert.status,
          title: alert.title,
          summary: alert.summary,
          payload: toInputJson(alert.payload),
          createdAt: alert.createdAt,
          acknowledgedAt: alert.acknowledgedAt ?? null,
        },
      });
    }
  });
}

async function seedUsage(tenantId: string) {
  const today = normalizeToDate(new Date());

  await withTenantContext(prisma, tenantId, async (tx) => {
    const activeWidgets = await tx.tenantWidget.count();

    for (let offset = 0; offset < 7; offset += 1) {
      const day = normalizeToDate(new Date(today.getTime() - offset * DAY_MS));
      const tokensUsed = 900 + offset * 75;
      const tasksExecuted = 6 + offset;
      const alertsTriggered = offset % 3 === 0 ? 1 : 0;
      const apiCalls = 35 + offset * 4;
      const storageBytes = BigInt(5_000_000 + offset * 250_000);

      const metadata = toInputJson({
        seeded: true,
        lastEventType: 'seed.slice6.usage',
        lastEventAt: day.toISOString(),
      });

      await tx.billingUsage.upsert({
        where: {
          tenantId_date: {
            tenantId,
            date: day,
          },
        },
        update: {
          tokensUsed,
          tasksExecuted,
          alertsTriggered,
          activeWidgets,
          metadata,
        },
        create: {
          tenantId,
          date: day,
          tokensUsed,
          tasksExecuted,
          alertsTriggered,
          activeWidgets,
          metadata,
        },
      });

      await tx.usageSnapshot.upsert({
        where: {
          tenantId_date: {
            tenantId,
            date: day,
          },
        },
        update: {
          apiCalls,
          tokensUsed,
          tasksExecuted,
          storageBytes,
          alertsTriggered,
          activeWidgets,
          summary: toInputJson({
            seeded: true,
            label: 'Slice 6 demo data',
            tokensUsed,
          }),
        },
        create: {
          tenantId,
          date: day,
          apiCalls,
          tokensUsed,
          tasksExecuted,
          storageBytes,
          alertsTriggered,
          activeWidgets,
          summary: toInputJson({
            seeded: true,
            label: 'Slice 6 demo data',
            tokensUsed,
          }),
        },
      });
    }
  });
}

async function main() {
  const tenantId = getArgValue('--tenant') ?? 'tenant-slice6-demo';
  const tenantName = getArgValue('--tenant-name') ?? 'Slice 6 Demo Tenant';
  const tenantSlug = getArgValue('--tenant-slug');

  console.log(`Seeding Slice 6 demo data for tenant "${tenantId}"...`);

  const tenant = await ensureTenant({ tenantId, tenantName, tenantSlug });
  console.log(`Tenant ready with slug "${tenant.slug}".`);

  const { widget, created } = await seedMarketplace(tenantId);
  console.log(`Widget "${widget.slug}" ${created ? 'registered' : 'updated'} and installed.`);

  await seedTriggersAndAlerts(tenantId);
  console.log('Triggers and alerts seeded.');

  await seedUsage(tenantId);
  console.log('Billing usage and usage snapshots seeded.');

  console.log('Slice 6 seed complete.');
}

main()
  .catch((error) => {
    console.error('Slice 6 seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
