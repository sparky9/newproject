import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Phase 2 demo data...');

  // Find or create demo tenant
  let tenant = await prisma.tenant.findFirst({
    where: { name: 'Demo Company' },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Demo Company',
        slug: 'demo-company',
      },
    });
    console.log('✅ Created demo tenant:', tenant.id);
  } else {
    console.log('✅ Using existing demo tenant:', tenant.id);
  }

  // Create or update business profile
  const businessProfile = await prisma.businessProfile.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      industry: 'SaaS',
      size: 'small',
      revenue: '500000',
      stage: 'growth',
      goals: ['Increase revenue by 30%', 'Improve conversion rate', 'Expand to new markets'],
    },
    update: {
      industry: 'SaaS',
      size: 'small',
      revenue: '500000',
      stage: 'growth',
      goals: ['Increase revenue by 30%', 'Improve conversion rate', 'Expand to new markets'],
    },
  });
  console.log('✅ Created/updated business profile:', businessProfile.id);

  // Create analytics snapshots (last 30 days)
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today
  const snapshots = [];

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Generate realistic trending data
    const baseUsers = 100 + Math.floor(Math.random() * 50);
    const growthFactor = 1 + (29 - i) * 0.02; // 2% growth per day
    const users = Math.floor(baseUsers * growthFactor);
    const sessions = Math.floor(users * (1.3 + Math.random() * 0.4));
    const conversions = Math.floor(users * (0.03 + Math.random() * 0.02));
    const revenue = conversions * (50 + Math.random() * 100);

    snapshots.push({
      tenantId: tenant.id,
      date,
      sessions,
      users,
      conversions,
      revenue,
      sourceBreakdown: {
        organic: Math.floor(sessions * 0.4),
        paid: Math.floor(sessions * 0.3),
        social: Math.floor(sessions * 0.15),
        direct: Math.floor(sessions * 0.1),
        referral: Math.floor(sessions * 0.05),
      },
    });
  }

  // Delete existing snapshots for this tenant to avoid conflicts
  await prisma.analyticsSnapshot.deleteMany({
    where: {
      tenantId: tenant.id,
    },
  });

  await prisma.analyticsSnapshot.createMany({
    data: snapshots,
    skipDuplicates: true,
  });
  console.log(`✅ Created ${snapshots.length} analytics snapshots`);

  // Calculate metrics from snapshots for the insight
  const totalRevenue = snapshots.reduce((sum, s) => sum + s.revenue, 0);
  const totalUsers = snapshots.reduce((sum, s) => sum + s.users, 0);
  const totalConversions = snapshots.reduce((sum, s) => sum + s.conversions, 0);
  const totalSessions = snapshots.reduce((sum, s) => sum + s.sessions, 0);

  // Calculate growth rate (comparing first half vs second half)
  const midPoint = Math.floor(snapshots.length / 2);
  const firstHalfRevenue = snapshots.slice(0, midPoint).reduce((sum, s) => sum + s.revenue, 0);
  const secondHalfRevenue = snapshots.slice(midPoint).reduce((sum, s) => sum + s.revenue, 0);
  const growthRate = firstHalfRevenue > 0
    ? ((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue) * 100
    : 0;

  const conversionRate = totalSessions > 0 ? (totalConversions / totalSessions) * 100 : 0;
  const avgDailyRevenue = totalRevenue / snapshots.length;

  // Create module insight
  const insight = {
    tenantId: tenant.id,
    moduleSlug: 'growth-pulse',
    severity: 'info',
    summary: `Strong growth trajectory with ${growthRate.toFixed(1)}% revenue increase over the past 30 days. Conversion rate remains stable at ${conversionRate.toFixed(2)}%. Total revenue of $${totalRevenue.toFixed(2)} with ${totalUsers} users.`,
    highlights: [
      `Revenue up ${growthRate.toFixed(1)}% compared to first half of period`,
      `User growth accelerating with ${totalUsers} total users`,
      `Conversion rate stable at ${conversionRate.toFixed(2)}%`,
      `Top traffic source: Organic search (40%)`,
      `Average daily revenue: $${avgDailyRevenue.toFixed(2)}`,
    ],
    score: 78,
    actionItems: [
      {
        title: 'Optimize paid advertising campaigns',
        description: 'Focus budget on high-converting keywords to maximize ROI',
        priority: 'high',
        estimatedImpact: 'Increase revenue by 10-15%',
      },
      {
        title: 'Improve social media presence',
        description: 'Increase posting frequency and engagement to boost traffic',
        priority: 'medium',
        estimatedImpact: 'Boost traffic by 20%',
      },
      {
        title: 'A/B test landing pages',
        description: 'Test different headlines and CTAs to improve conversion rate',
        priority: 'medium',
        estimatedImpact: 'Improve conversion rate by 0.5-1%',
      },
    ],
    metadata: {
      totalRevenue,
      avgDailyRevenue,
      totalUsers,
      totalConversions,
      totalSessions,
      growthRate,
      conversionRate,
      dataPoints: snapshots.length,
    },
  };

  // Delete existing insights for this module to avoid duplicates
  await prisma.moduleInsight.deleteMany({
    where: {
      tenantId: tenant.id,
      moduleSlug: 'growth-pulse',
    },
  });

  const moduleInsight = await prisma.moduleInsight.create({
    data: insight,
  });
  console.log(`✅ Created module insight:`, moduleInsight.id);

  console.log('\n🎉 Phase 2 seeding complete!');
  console.log(`\nDemo tenant ID: ${tenant.id}`);
  console.log(`Snapshots: ${snapshots.length}`);
  console.log(`Total revenue: $${totalRevenue.toFixed(2)}`);
  console.log(`Growth rate: ${growthRate.toFixed(1)}%`);
  console.log(`Conversion rate: ${conversionRate.toFixed(2)}%`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
