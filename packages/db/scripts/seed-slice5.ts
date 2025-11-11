import { PrismaClient, Prisma, TenantMemberRole } from '@prisma/client';

const prisma = new PrismaClient();

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
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

async function resetPhase5Data(tenantId: string) {
  console.log('🧹 Resetting Phase 5 knowledge data for demo tenant…');
  await prisma.knowledgeEntry.deleteMany({ where: { tenantId } });
  await prisma.knowledgeSource.deleteMany({ where: { tenantId } });
}

type EntrySeed = {
  content: string;
  personas: string[];
  tags: string[];
  section: string;
  title: string;
  minutesOffset?: number;
  retentionDays?: number;
  tokenCount?: number;
};

async function createEntriesForSource(
  tenantId: string,
  sourceId: string,
  sourceName: string,
  entries: EntrySeed[],
  totalChunks: number
) {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const metadata: Prisma.JsonObject = {
      personas: entry.personas,
      tags: entry.tags,
      documentTitle: sourceName,
      section: entry.section,
      heading: entry.title,
      chunkIndex: index + 1,
      chunkCount: totalChunks,
    };

    await prisma.knowledgeEntry.create({
      data: {
        tenantId,
        source: `seed:${sourceName.toLowerCase().replace(/\s+/g, '-')}`,
        sourceId,
        content: entry.content,
        metadata,
        tokenCount: entry.tokenCount ?? Math.max(180, entry.content.length / 4),
        retentionExpiresAt: entry.retentionDays
          ? daysFromNow(entry.retentionDays)
          : null,
        createdAt: entry.minutesOffset ? minutesAgo(entry.minutesOffset) : undefined,
        updatedAt: entry.minutesOffset ? minutesAgo(entry.minutesOffset) : undefined,
      },
    });
  }
}

async function seedKnowledgeSources(tenantId: string) {
  console.log('📚 Creating knowledge sources and entries…');

  const onboardingGuide = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      name: 'Customer Onboarding Playbook',
      type: 'file_upload',
      provider: 'upload',
      status: 'ready',
      storageStrategy: 'managed_postgres',
      retentionPolicy: 'retain_indefinitely',
      configuration: {
        filename: 'customer-onboarding-playbook.pdf',
        ingestVersion: 1,
      },
      lastSyncedAt: minutesAgo(15),
    },
  });

  const onboardingEntries: EntrySeed[] = [
    {
      title: 'Executive Summary',
      section: 'Overview',
      personas: ['ceo', 'cmo'],
      tags: ['onboarding', 'strategy'],
      content:
        'Our onboarding journey is a 30-day program focused on reducing time-to-value. Success metrics include time-to-first-value under 5 days and a 60% trial-to-paid conversion rate. Every touchpoint is scripted and measured.',
      minutesOffset: 120,
      tokenCount: 210,
    },
    {
      title: 'Kickoff Call Agenda',
      section: 'Week 1',
      personas: ['cso', 'csm'],
      tags: ['enablement', 'success'],
      content:
        'Kickoff calls follow a five-step flow: vision validation, success metrics, system overview, next steps recap, and executive alignment. Include the mutual action plan and confirm stakeholder availability.',
      minutesOffset: 115,
      tokenCount: 235,
    },
    {
      title: 'Success Metrics Template',
      section: 'Week 1',
      personas: ['cfo', 'ops'],
      tags: ['metrics', 'template'],
      content:
        'Capture baseline metrics using the provided template. Required fields: activation rate, expansion pipeline, core integrations, and executive sponsor sentiment. Update the dashboard within 24 hours of the kickoff.',
      minutesOffset: 110,
      tokenCount: 198,
    },
    {
      title: 'Automation Checklist',
      section: 'Week 2',
      personas: ['cto', 'ops'],
      tags: ['automation', 'playbook'],
      content:
        'Week two focuses on automation. Deploy trigger-based campaigns for onboarding emails, activate product usage alerts, and configure the renewal health webhook. Audit the workflow in the RevOps sandbox before enabling.',
      minutesOffset: 95,
      tokenCount: 224,
    },
    {
      title: 'Executive Sync Outline',
      section: 'Week 3',
      personas: ['ceo', 'csm'],
      tags: ['meeting', 'template'],
      content:
        'Schedule an executive sync with both internal and client sponsors. Highlight early wins, forecast adoption, and flag risks that require mitigation. Use the confidence scoring rubric to drive the conversation.',
      minutesOffset: 80,
      tokenCount: 205,
    },
    {
      title: '30-Day Review Framework',
      section: 'Week 4',
      personas: ['csm', 'ops'],
      tags: ['review', 'reporting'],
      content:
        'At day 30 deliver a structured executive review covering adoption, ROI signals, and open action items. Include benchmark comparisons, stakeholder feedback, and a recommendation on expansion readiness.',
      minutesOffset: 65,
      tokenCount: 238,
    },
    {
      title: 'Playbook Lessons Learned',
      section: 'Retrospective',
      personas: ['ops'],
      tags: ['retro', 'insights'],
      content:
        'The last five implementations highlight two consistent friction points: delayed stakeholder mapping and under-utilized training assets. Mitigate by scheduling stakeholder mapping during discovery and pre-loading LMS paths.',
      minutesOffset: 50,
      tokenCount: 189,
    },
  ];

  await createEntriesForSource(
    tenantId,
    onboardingGuide.id,
    onboardingGuide.name,
    onboardingEntries,
    onboardingEntries.length
  );

  const financeDigest = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      name: 'Weekly Finance Digest',
      type: 'manual_note',
      provider: 'manual',
      status: 'ready',
      storageStrategy: 'managed_postgres',
      retentionPolicy: 'rolling_90_days',
      configuration: {
        authoredBy: 'demo-founder-user',
      },
      lastSyncedAt: minutesAgo(30),
    },
  });

  const financeEntries: EntrySeed[] = [
    {
      title: 'ARR Snapshot',
      section: 'Financial Metrics',
      personas: ['cfo', 'ceo'],
      tags: ['arr', 'metrics'],
      content:
        'Monthly recurring revenue closed the week at $486K ARR with 3.4% net growth. Two expansion deals are in contracting and expected to add $38K ARR next cycle.',
      minutesOffset: 45,
      retentionDays: 85,
      tokenCount: 160,
    },
    {
      title: 'Cash Position',
      section: 'Financial Metrics',
      personas: ['cfo'],
      tags: ['cash', 'runway'],
      content:
        'Operating cash stands at $2.4M with 13.5 months runway at current burn. Approved the vendor consolidation plan which will reduce monthly spend by $18K starting next quarter.',
      minutesOffset: 42,
      retentionDays: 85,
      tokenCount: 175,
    },
    {
      title: 'Expense Watchlist',
      section: 'Operational Alerts',
      personas: ['cfo', 'ops'],
      tags: ['alerts', 'spend'],
      content:
        'Identified a spike in AWS spend tied to the analytics feature flag rollout. Ops to coordinate with engineering to validate automatic scaling thresholds before Friday.',
      minutesOffset: 40,
      retentionDays: 85,
      tokenCount: 190,
    },
    {
      title: 'Collections Update',
      section: 'Operational Alerts',
      personas: ['finance', 'ops'],
      tags: ['collections'],
      content:
        'Collections are 96% current. One enterprise customer is 18 days late due to procurement lockout; account owner engaged their finance counterpart and expects resolution by Wednesday.',
      minutesOffset: 38,
      retentionDays: 85,
      tokenCount: 188,
    },
    {
      title: 'Board Call Prep',
      section: 'Executive Highlights',
      personas: ['ceo', 'cfo'],
      tags: ['board', 'prep'],
      content:
        'Drafted board call talking points for next week: 1) pipeline quality recovery, 2) hiring freeze impacts, 3) readiness of enterprise analytics module. Materials ready for review Friday afternoon.',
      minutesOffset: 35,
      retentionDays: 85,
      tokenCount: 182,
    },
  ];

  await createEntriesForSource(
    tenantId,
    financeDigest.id,
    financeDigest.name,
    financeEntries,
    financeEntries.length
  );

  const battlecards = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      name: 'Competitive Battlecards',
      type: 'cloud_sync',
      provider: 'notion',
      status: 'ready',
      storageStrategy: 'managed_postgres',
      retentionPolicy: 'manual_purge',
      configuration: {
        workspace: 'go-to-market-wiki',
        pageId: 'competitive-intel',
      },
      lastSyncedAt: minutesAgo(10),
    },
  });

  const battlecardEntries: EntrySeed[] = [
    {
      title: 'Northwind Advantage Summary',
      section: 'Northwind CRM',
      personas: ['cmo', 'sales'],
      tags: ['competitive', 'crm'],
      content:
        'Northwind CRM messaging should emphasize predictive insights, embedded AI coaching, and integrations with legacy ERP stacks. Counter their claims on implementation time with our 21-day launch proof points.',
      minutesOffset: 25,
      tokenCount: 220,
    },
    {
      title: 'Acme Analytics Objection Handling',
      section: 'Acme Analytics',
      personas: ['sales', 'product'],
      tags: ['objections'],
      content:
        'When Acme argues deeper BI coverage, pivot to our workflow automation layer and embedded activation triggers. Share the case study showing a 27% conversion lift after replacing Acme in a retail vertical.',
      minutesOffset: 22,
      tokenCount: 215,
    },
    {
      title: 'Pricing Comparison Grid',
      section: 'Core Pricing',
      personas: ['sales', 'finance'],
      tags: ['pricing'],
      content:
        'Maintain the pricing grid with land, expand, and enterprise tiers. Highlight that volume-based automation credits are included, whereas competitors charge an extra platform fee plus usage surcharges.',
      minutesOffset: 18,
      tokenCount: 205,
    },
    {
      title: 'Win Stories Library',
      section: 'Proof Points',
      personas: ['sales', 'marketing'],
      tags: ['stories', 'social-proof'],
      content:
        'Updated with three new win stories featuring manufacturing, fintech, and healthcare. Each includes challenge, deployment approach, 90-day results, and champion quotes ready for social amplification.',
      minutesOffset: 15,
      tokenCount: 212,
    },
  ];

  await createEntriesForSource(
    tenantId,
    battlecards.id,
    battlecards.name,
    battlecardEntries,
    battlecardEntries.length
  );
}

async function main() {
  try {
    const { tenant } = await ensureTenantAndMembers();
    await resetPhase5Data(tenant.id);
    await seedKnowledgeSources(tenant.id);
    console.log('🎉 Phase 5 knowledge data seeded successfully.');
  } catch (error) {
    console.error('❌ Failed to seed Phase 5 data', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
