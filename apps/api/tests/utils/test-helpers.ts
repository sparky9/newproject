import { createTenantClient, prisma } from '@ocsuite/db';
import { randomUUID } from 'crypto';

/**
 * Test tenant and user IDs for consistent testing
 */
export const TEST_TENANT_ID = 'test-tenant-00000000-0000-0000-0000-000000000001';
export const TEST_USER_ID = 'test-user-00000000-0000-0000-0000-000000000001';

/**
 * Generate a mock Clerk JWT token for testing
 * In a real implementation, you would use the Clerk SDK to generate test tokens
 */
export function generateMockJWT(userId: string = TEST_USER_ID): string {
  // This is a mock token - in production tests, you'd use Clerk's test tokens
  // or mock the JWT validation middleware
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    sid: 'test-session-id',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  })).toString('base64');
  const signature = 'mock-signature';

  return `${header}.${payload}.${signature}`;
}

/**
 * Create a test tenant in the database
 */
export async function createTestTenant(tenantId: string = TEST_TENANT_ID) {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });

  if (existing) {
    return existing;
  }

  return prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'Test Tenant',
      slug: tenantId,
    },
  });
}

/**
 * Create a test user in the database
 */
export async function createTestUser(
  tenantId: string = TEST_TENANT_ID,
  userId: string = TEST_USER_ID
) {
  await createTestTenant(tenantId);

  const email = `${userId}@example.com`;

  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      clerkId: userId,
      email,
      name: 'Test User',
    },
  });

  await prisma.tenantMember.upsert({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
    update: {
      role: 'owner',
    },
    create: {
      tenantId,
      userId,
      role: 'owner',
    },
  });

  return user;
}

/**
 * Clean up test data after tests
 */
export async function cleanupTestData(
  tenantId: string = TEST_TENANT_ID,
  userId: string = TEST_USER_ID
) {
  const tenantDb = createTenantClient({ tenantId, userId: 'system' });

  try {
    await tenantDb.billingUsage.deleteMany();
    await tenantDb.boardActionItem.deleteMany();
    await tenantDb.boardPersonaTurn.deleteMany();
    await tenantDb.boardMeeting.deleteMany();
    await tenantDb.notification.deleteMany();
    await tenantDb.notificationPreference.deleteMany();
    await tenantDb.actionApproval.deleteMany();
    await tenantDb.analyticsSnapshot.deleteMany();
    await tenantDb.moduleInsight.deleteMany();
    await tenantDb.alert.deleteMany();
    await tenantDb.triggerRule.deleteMany();
    await tenantDb.usageSnapshot.deleteMany();
    await tenantDb.tenantWidget.deleteMany();
    await tenantDb.task.deleteMany();
    await tenantDb.connector.deleteMany();
    await tenantDb.message.deleteMany();
    await tenantDb.conversation.deleteMany();
    await tenantDb.businessProfile.deleteMany();
  } catch (error) {
    console.error('Error cleaning tenant data:', error);
  } finally {
    await tenantDb.$disconnect();
  }

  await prisma.tenantMember.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { id: userId },
        { clerkId: userId },
        { email: `${userId}@example.com` },
      ],
    },
  });
  await prisma.widget.deleteMany({
    where: {
      slug: {
        startsWith: 'test-',
      },
    },
  });
  const existingTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (existingTenant) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
  }
}

/**
 * Wait for a specific condition to be met
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error('Timeout waiting for condition');
}

/**
 * Parse SSE (Server-Sent Events) stream data
 */
export function parseSSEData(data: string): Record<string, unknown>[] {
  const lines = data.split('\n');
  const events: Record<string, unknown>[] = [];

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const jsonData = JSON.parse(line.substring(6)) as Record<string, unknown>;
        events.push(jsonData);
      } catch (error) {
        // Skip invalid JSON
      }
    }
  }

  return events;
}

/**
 * Generate a unique test ID
 */
export function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${randomUUID()}`;
}
