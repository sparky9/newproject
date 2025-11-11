import { prisma, withTenantContext } from '../src/index';

async function ensureSeedData() {
  await prisma.tenant.upsert({
    where: { id: 'test-tenant-1' },
    create: { id: 'test-tenant-1', name: 'Tenant 1', slug: 'tenant-1' },
    update: {},
  });
  await prisma.tenant.upsert({
    where: { id: 'test-tenant-2' },
    create: { id: 'test-tenant-2', name: 'Tenant 2', slug: 'tenant-2' },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: 'test-user-1' },
    create: {
      id: 'test-user-1',
      clerkId: 'debug-clerk-1',
      email: 'debug1@example.com',
    },
    update: {},
  });
  await prisma.user.upsert({
    where: { id: 'test-user-2' },
    create: {
      id: 'test-user-2',
      clerkId: 'debug-clerk-2',
      email: 'debug2@example.com',
    },
    update: {},
  });
}

async function main() {
  await ensureSeedData();

  const policies = await prisma.$queryRaw<{ policyname: string }[]>`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'conversations'
  `;
  console.log('RLS policies on conversations:', policies);

  const roleInfo = await prisma.$queryRaw<{ rolname: string; rolbypassrls: boolean }[]>`
    SELECT rolname, rolbypassrls
    FROM pg_roles
    WHERE rolname = current_user
  `;
  console.log('Current role info:', roleInfo);

  await withTenantContext(prisma, 'test-tenant-1', async (tx) => {
    await tx.conversation.upsert({
      where: { id: 'debug-conv-1' },
      create: {
        id: 'debug-conv-1',
        tenantId: 'test-tenant-1',
        userId: 'test-user-1',
        personaType: 'ceo',
        title: 'Tenant 1 Conversation',
      },
      update: {},
    });
  });

  await withTenantContext(prisma, 'test-tenant-2', async (tx) => {
    await tx.conversation.upsert({
      where: { id: 'debug-conv-2' },
      create: {
        id: 'debug-conv-2',
        tenantId: 'test-tenant-2',
        userId: 'test-user-2',
        personaType: 'cfo',
        title: 'Tenant 2 Conversation',
      },
      update: {},
    });
  });

  const rows = await withTenantContext(prisma, 'test-tenant-1', async (tx) => {
    const results = await tx.$queryRaw<{ tenant: string | null; row_security: string }[]>`
      SELECT current_setting('app.current_tenant_id', true) AS tenant,
             current_setting('row_security') AS row_security
    `;
    const conversations = await tx.conversation.findMany({
      select: { id: true, tenantId: true, title: true },
      orderBy: { tenantId: 'asc' },
    });
    return { results, conversations };
  });

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error('check-rls error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
