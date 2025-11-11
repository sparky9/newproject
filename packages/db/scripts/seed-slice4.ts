import { PrismaClient, Prisma, TenantMemberRole } from '@prisma/client';

const prisma = new PrismaClient();

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function buildAuditEvents(events: Array<{
  event: 'submitted' | 'approved' | 'rejected' | 'enqueued' | 'executing' | 'completed' | 'failed';
  offsetMinutes: number;
  by: string;
  note?: string;
  metadata?: Record<string, unknown>;
}>): Prisma.JsonArray {
  return events.map((entry) => ({
    event: entry.event,
    at: minutesAgo(entry.offsetMinutes).toISOString(),
    by: entry.by,
    ...(entry.note ? { note: entry.note } : {}),
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
  })) as Prisma.JsonArray;
}

async function ensureTenantAndMembers() {
  let tenant = await prisma.tenant.findFirst({
    where: { slug: 'demo-company' },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Demo Company',
        slug: 'demo-company',
      },
    });
    console.log(`✅ Created demo tenant ${tenant.id}`);
  } else {
    console.log(`✅ Using existing demo tenant ${tenant.id}`);
  }

  const founder = await prisma.user.upsert({
    where: { clerkId: 'demo-founder-user' },
    update: {
      email: 'founder@demo-company.com',
      name: 'Demo Founder',
    },
    create: {
      clerkId: 'demo-founder-user',
      email: 'founder@demo-company.com',
      name: 'Demo Founder',
    },
  });

  const opsLead = await prisma.user.upsert({
    where: { clerkId: 'demo-ops-user' },
    update: {
      email: 'ops@demo-company.com',
      name: 'Operations Lead',
    },
    create: {
      clerkId: 'demo-ops-user',
      email: 'ops@demo-company.com',
      name: 'Operations Lead',
    },
  });

  await prisma.tenantMember.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: founder.id,
      },
    },
    update: {
      role: TenantMemberRole.owner,
    },
    create: {
      tenantId: tenant.id,
      userId: founder.id,
      role: TenantMemberRole.owner,
    },
  });

  await prisma.tenantMember.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: opsLead.id,
      },
    },
    update: {
      role: TenantMemberRole.admin,
    },
    create: {
      tenantId: tenant.id,
      userId: opsLead.id,
      role: TenantMemberRole.admin,
    },
  });

  return { tenant, founder, opsLead };
}

async function resetPhase4Data(tenantId: string) {
  console.log('🧹 Resetting existing Phase 4 data for demo tenant…');

  await prisma.notification.deleteMany({ where: { tenantId } });
  await prisma.notificationPreference.deleteMany({ where: { tenantId } });
  await prisma.task.deleteMany({
    where: {
      tenantId,
      actionApprovalId: { not: null },
    },
  });
  await prisma.actionApproval.deleteMany({ where: { tenantId } });
}

async function seedNotificationPreferences(tenantId: string, userId: string, overrides?: Partial<Record<'in_app' | 'email' | 'slack_stub', boolean>>) {
  const defaults: Record<'in_app' | 'email' | 'slack_stub', boolean> = {
    in_app: true,
    email: false,
    slack_stub: false,
  };

  const entries = Object.entries({ ...defaults, ...(overrides ?? {}) }).map(([channel, enabled]) => ({
    tenantId,
    userId,
    channel: channel as 'in_app' | 'email' | 'slack_stub',
    enabled,
  }));

  await prisma.notificationPreference.createMany({
    data: entries,
    skipDuplicates: true,
  });
}

async function seedActionApprovals(tenantId: string, founder: { id: string; clerkId: string }, ops: { id: string; clerkId: string }) {
  console.log('🛠️  Creating demo action approvals…');

  const pendingApproval = await prisma.actionApproval.create({
    data: {
      tenantId,
      source: 'module:growth-pulse',
      payload: {
        summary: 'Launch nurture email to re-engage dormant trials',
        description: 'Send a tailored re-engagement email to the 45-day inactive trial segment with updated product highlights.',
        moduleSlug: 'growth-pulse',
        capability: 'send-segment-email',
        segmentSize: 120,
        undoPayload: {
          campaignId: 'trial-reactivation-q4',
        },
      } satisfies Prisma.JsonObject,
      riskScore: 82,
      status: 'pending',
      createdBy: founder.clerkId,
      auditLog: buildAuditEvents([
        {
          event: 'submitted',
          offsetMinutes: 45,
          by: founder.clerkId,
          note: 'Proposed after activation review.',
          metadata: {
            riskScore: 82,
            riskLevel: 'high',
            riskReasons: ['Emails > 100 contacts', 'External messaging'],
          },
        },
      ]),
    },
  });

  const mediumRiskApproval = await prisma.actionApproval.create({
    data: {
      tenantId,
      source: 'module:revops-orchestrator',
      payload: {
        summary: 'Update Salesforce pipeline stages for stalled deals',
        description: 'Move 12 opportunities stuck in "Evaluation" for 21 days to the "Revive" sequence and assign follow-up tasks.',
        moduleSlug: 'revops-orchestrator',
        capability: 'pipeline-update',
        affectedRecords: 12,
      } satisfies Prisma.JsonObject,
      riskScore: 56,
      status: 'pending',
      createdBy: ops.clerkId,
      auditLog: buildAuditEvents([
        {
          event: 'submitted',
          offsetMinutes: 30,
          by: ops.clerkId,
          metadata: {
            riskScore: 56,
            riskLevel: 'medium',
            riskReasons: ['Impacts CRM data', 'Bulk record update'],
          },
        },
      ]),
    },
  });

  const executingApproval = await prisma.actionApproval.create({
    data: {
      tenantId,
      source: 'module:ops-automator',
      payload: {
        summary: 'Sync Stripe subscription status for risk accounts',
        description: 'Cross-check churn-risk accounts against billing records and flag any delinquent subscriptions for manual review.',
        moduleSlug: 'ops-automator',
        capability: 'billing-sync',
        batchSize: 38,
      } satisfies Prisma.JsonObject,
      riskScore: 41,
      status: 'executing',
      createdBy: founder.clerkId,
      approvedBy: ops.clerkId,
      approvedAt: minutesAgo(25),
      auditLog: buildAuditEvents([
        {
          event: 'submitted',
          offsetMinutes: 120,
          by: founder.clerkId,
          metadata: {
            riskScore: 41,
            riskLevel: 'medium',
            riskReasons: ['Touches billing data'],
          },
        },
        {
          event: 'approved',
          offsetMinutes: 28,
          by: ops.clerkId,
          note: 'Looks safe; monitoring execution.',
        },
        {
          event: 'enqueued',
          offsetMinutes: 27,
          by: ops.clerkId,
          metadata: {
            queueName: 'action-executor',
            jobId: 'demo-job-ops-sync',
          },
        },
        {
          event: 'executing',
          offsetMinutes: 5,
          by: 'system',
          metadata: {
            progress: 32,
            total: 38,
          },
        },
      ]),
    },
  });

  await prisma.task.create({
    data: {
      tenantId,
      userId: founder.id,
      type: 'action-execution',
      status: 'running',
      priority: 'normal',
      payload: executingApproval.payload,
      moduleSlug: 'ops-automator',
      queueName: 'action-executor',
      jobId: 'demo-job-ops-sync',
      actionApprovalId: executingApproval.id,
      createdAt: minutesAgo(26),
      updatedAt: new Date(),
    },
  });

  const executedApproval = await prisma.actionApproval.create({
    data: {
      tenantId,
      source: 'module:engage-ai',
      payload: {
        summary: 'Publish LinkedIn recap of Q3 metrics',
        description: 'Generate and post a recap highlighting Q3 ARR, pipeline velocity, and top customer wins to the company page.',
        moduleSlug: 'engage-ai',
        capability: 'social-post',
        channels: ['linkedin'],
      } satisfies Prisma.JsonObject,
      riskScore: 22,
      status: 'executed',
      createdBy: ops.clerkId,
      approvedBy: founder.clerkId,
      approvedAt: minutesAgo(95),
      executedAt: minutesAgo(10),
      auditLog: buildAuditEvents([
        {
          event: 'submitted',
          offsetMinutes: 180,
          by: ops.clerkId,
          metadata: {
            riskScore: 22,
            riskLevel: 'low',
            riskReasons: ['Single channel publish'],
          },
        },
        {
          event: 'approved',
          offsetMinutes: 100,
          by: founder.clerkId,
          note: 'Greenlit for morning publish.',
        },
        {
          event: 'enqueued',
          offsetMinutes: 98,
          by: founder.clerkId,
          metadata: {
            queueName: 'action-executor',
            jobId: 'demo-job-engage-ai',
          },
        },
        {
          event: 'executing',
          offsetMinutes: 20,
          by: 'system',
        },
        {
          event: 'completed',
          offsetMinutes: 10,
          by: 'system',
          metadata: {
            postUrl: 'https://www.linkedin.com/company/demo-company/posts/q3-recap',
          },
        },
      ]),
    },
  });

  await prisma.task.create({
    data: {
      tenantId,
      userId: ops.id,
      type: 'action-execution',
      status: 'completed',
      priority: 'normal',
      payload: executedApproval.payload,
      moduleSlug: 'engage-ai',
      queueName: 'action-executor',
      jobId: 'demo-job-engage-ai',
      actionApprovalId: executedApproval.id,
      executedAt: minutesAgo(10),
      result: {
        status: 'posted',
        externalId: 'demo-li-post-123',
      } satisfies Prisma.JsonObject,
      createdAt: minutesAgo(99),
      updatedAt: minutesAgo(10),
    },
  });

  return {
    pendingApproval,
    mediumRiskApproval,
    executingApproval,
    executedApproval,
  };
}

async function seedNotifications(
  tenantId: string,
  founder: { id: string; clerkId: string },
  ops: { id: string; clerkId: string },
  approvals: ReturnType<typeof seedActionApprovals> extends Promise<infer R> ? R : never
) {
  console.log('🔔 Creating sample notifications…');

  await prisma.notification.createMany({
    data: [
      {
        tenantId,
        userId: ops.id,
        type: 'action-approval.submitted',
        channel: 'in_app',
        payload: {
          approvalId: approvals.pendingApproval.id,
          risk: {
            score: approvals.pendingApproval.riskScore,
            level: 'high',
          },
          moduleSlug: 'growth-pulse',
        } satisfies Prisma.JsonObject,
        createdAt: minutesAgo(44),
      },
      {
        tenantId,
        userId: founder.id,
        type: 'action-approval.approved',
        channel: 'in_app',
        payload: {
          approvalId: approvals.executingApproval.id,
          decision: 'approved',
          approvedBy: ops.clerkId,
        } satisfies Prisma.JsonObject,
        createdAt: minutesAgo(27),
        readAt: minutesAgo(20),
      },
      {
        tenantId,
        userId: ops.id,
        type: 'action-approval.executed',
        channel: 'in_app',
        payload: {
          approvalId: approvals.executedApproval.id,
          result: 'executed',
          metadata: {
            postUrl: 'https://www.linkedin.com/company/demo-company/posts/q3-recap',
          },
        } satisfies Prisma.JsonObject,
        createdAt: minutesAgo(9),
      },
    ],
  });
}

async function main() {
  console.log('🌱 Seeding Phase 4 demo data...');

  const { tenant, founder, opsLead } = await ensureTenantAndMembers();

  await resetPhase4Data(tenant.id);

  await seedNotificationPreferences(tenant.id, founder.id, { email: true });
  await seedNotificationPreferences(tenant.id, opsLead.id, { email: true, slack_stub: true });

  const approvals = await seedActionApprovals(tenant.id, { id: founder.id, clerkId: founder.clerkId }, { id: opsLead.id, clerkId: opsLead.clerkId });

  await seedNotifications(tenant.id, { id: founder.id, clerkId: founder.clerkId }, { id: opsLead.id, clerkId: opsLead.clerkId }, approvals);

  console.log('\n🎉 Phase 4 demo data ready!');
  console.log(`Tenant: ${tenant.slug}`);
  console.log(`Pending approvals: 2`);
  console.log(`Execution samples: 2`);
  console.log('Notifications seeded for founder + ops lead.');
}

main()
  .catch((error) => {
    console.error('❌ Phase 4 seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
