import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Phase 3 (Slice 3) demo data...');

  // Ensure demo tenant exists
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

  // Ensure demo executive user & member exist
  const user = await prisma.user.upsert({
    where: { email: 'founder@demo-company.com' },
    update: {
      name: 'Demo Founder',
    },
    create: {
      email: 'founder@demo-company.com',
      clerkId: 'demo-founder-user',
      name: 'Demo Founder',
    },
  });

  const member = await prisma.tenantMember.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id,
      },
    },
    update: {
      role: 'owner',
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: 'owner',
    },
  });

  console.log(`✅ Executive member ready for assignments (${member.id})`);

  // Reset existing board meeting data for the tenant
  await prisma.boardActionItem.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.boardPersonaTurn.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.boardMeeting.deleteMany({ where: { tenantId: tenant.id } });

  const startedAt = new Date();
  const endedAt = new Date(startedAt.getTime() + 45 * 60 * 1000);

  const meeting = await prisma.boardMeeting.create({
    data: {
      tenantId: tenant.id,
      startedAt,
      endedAt,
      agendaVersion: 2,
      agenda: {
        sections: [
          { title: 'KPI Pulse', owner: 'CFO', focus: 'Revenue + burn trending' },
          { title: 'Growth Flash', owner: 'CMO', focus: 'Pipeline + conversion' },
          { title: 'Execution Radar', owner: 'CTO', focus: 'Platform health & delivery' },
          { title: 'CEO Wrap', owner: 'CEO', focus: 'Decisions & next steps' },
        ],
      },
      outcomeSummary:
        'Revenue and retention remain strong; unlock additional growth by allocating engineering capacity to activation funnel. Three follow-ups captured to tighten telemetry and unblock shipping velocity.',
      tokenUsage: {
        totalPromptTokens: 4200,
        totalCompletionTokens: 2800,
        personaBreakdown: {
          ceo: { prompt: 900, completion: 650 },
          cfo: { prompt: 1100, completion: 720 },
          cmo: { prompt: 1000, completion: 760 },
          cto: { prompt: 1200, completion: 670 },
        },
      },
      rating: 5,
      metadata: {
        durationMinutes: 45,
        attendees: 4,
        sentiment: 'upbeat',
      },
    },
  });

  console.log(`✅ Created board meeting ${meeting.id}`);

  const turnBaseTime = startedAt.getTime();
  await prisma.boardPersonaTurn.createMany({
    data: [
      {
        tenantId: tenant.id,
        meetingId: meeting.id,
        persona: 'ceo',
        role: 'ceo',
        content:
          'We held share of market despite spend cuts. Focus this sprint on unblocking activation P90 and clarifying telemetry roadmap so we can defend runway guidance.',
        metrics: { confidence: 0.88, sentiment: 'optimistic' },
        sequence: 1,
        streamedAt: new Date(turnBaseTime + 5 * 60 * 1000),
      },
      {
        tenantId: tenant.id,
        meetingId: meeting.id,
        persona: 'cfo',
        role: 'cfo',
        content:
          'MRR expanded 8% month-over-month; burn sits at $410K which extends runway to 12.4 months. To fund pipeline acceleration we can reallocate $60K from infrastructure budget if ops signs off.',
        metrics: { confidence: 0.92, focus: 'financials' },
        sequence: 2,
        streamedAt: new Date(turnBaseTime + 15 * 60 * 1000),
      },
      {
        tenantId: tenant.id,
        meetingId: meeting.id,
        persona: 'cmo',
        role: 'cmo',
        content:
          'Lead velocity is up 14% but activation conversion dipped to 27%. Growth experiment GP-41 is showing promise but needs engineering support for proper instrumentation.',
        metrics: { confidence: 0.86, topChannels: ['organic', 'partners'] },
        sequence: 3,
        streamedAt: new Date(turnBaseTime + 25 * 60 * 1000),
      },
      {
        tenantId: tenant.id,
        meetingId: meeting.id,
        persona: 'cto',
        role: 'cto',
        content:
          'Activation funnel suffers from legacy event tracking. We can deliver the telemetry patch and UX polish in the next sprint if we pause the low-impact integrations. Need clarity on success metrics before kick-off.',
        metrics: { confidence: 0.9, risk: 'instrumentation debt' },
        sequence: 4,
        streamedAt: new Date(turnBaseTime + 35 * 60 * 1000),
      },
    ],
  });

  console.log('✅ Inserted persona turns for CEO, CFO, CMO, and CTO');

  await prisma.boardActionItem.createMany({
    data: [
      {
        tenantId: tenant.id,
        meetingId: meeting.id,
        title: 'Ship activation telemetry patch',
        description: 'Finalize the analytics instrumentation updates for onboarding funnel and QA in staging.',
        status: 'in_progress',
        priority: 'high',
        assigneeId: member.id,
        dueDate: new Date(endedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        metadata: {
          sourcePersona: 'cto',
          successMetric: 'Activation completion rate back above 35%',
        },
      },
      {
        tenantId: tenant.id,
        meetingId: meeting.id,
        title: 'Reallocate marketing spend to top performing channels',
        description: 'Shift $60K budget from underperforming display campaigns into organic content and partner webinars.',
        status: 'open',
        priority: 'normal',
        dueDate: new Date(endedAt.getTime() + 14 * 24 * 60 * 60 * 1000),
        metadata: {
          sourcePersona: 'cfo',
          followUp: 'Review with finance during weekly sync',
        },
      },
      {
        tenantId: tenant.id,
        meetingId: meeting.id,
        title: 'Define activation success metrics with GTM + Product',
        description: 'Align on definition of PQL and activation success, then publish to telemetry runbook.',
        status: 'open',
        priority: 'high',
        metadata: {
          sourcePersona: 'ceo',
          ownerHint: 'GTM leadership',
        },
      },
    ],
  });

  console.log('✅ Created actionable follow-ups');
  console.log('\n🎉 Phase 3 demo data ready!');
  console.log(`Meeting ID: ${meeting.id}`);
  console.log(`Tenant ID: ${tenant.id}`);
}

main()
  .catch((error) => {
    console.error('❌ Phase 3 seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
