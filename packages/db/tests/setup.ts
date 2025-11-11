import { PrismaClient, Prisma } from '@prisma/client';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { config as loadEnv } from 'dotenv';
import path from 'path';

// Ensure test environment variables are loaded before creating Prisma client
const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
];

let envLoaded = false;
for (const envPath of envPaths) {
  const result = loadEnv({ path: envPath });
  if (!result.error) {
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  loadEnv();
}

// Test database client
export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    },
  },
});

type TxClient = Prisma.TransactionClient;

const DEFAULT_RLS_ROLE = 'rls_enforced_user';

const globalTestState = globalThis as typeof globalThis & {
  __ocsuiteEnsureRlsRolePromise?: Promise<void>;
};

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function withDisabledRowSecurity<T>(fn: (tx: TxClient) => Promise<T>) {
  return testPrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL row_security = off');
      return fn(tx);
    },
    {
      timeout: 30000,
    }
  );
}

async function ensureRlsTestRole() {
  if (!globalTestState.__ocsuiteEnsureRlsRolePromise) {
    globalTestState.__ocsuiteEnsureRlsRolePromise = (async () => {
      const role = process.env.RLS_ENFORCED_ROLE?.trim() || DEFAULT_RLS_ROLE;
      process.env.RLS_ENFORCED_ROLE = role;

      const quotedRole = quoteIdent(role);
      const escapedRoleLiteral = escapeLiteral(role);

      await testPrisma.$executeRawUnsafe(`
        DO $do$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${escapedRoleLiteral}') THEN
            EXECUTE 'CREATE ROLE ${quotedRole} NOLOGIN';
          END IF;
        END
        $do$;
      `);

      const grantStatements = [
        `GRANT ${quotedRole} TO CURRENT_USER`,
        `GRANT USAGE ON SCHEMA public TO ${quotedRole}`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole}`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRole}`,
      ];

      for (const sql of grantStatements) {
        await testPrisma.$executeRawUnsafe(sql);
      }
    })().catch((error) => {
      globalTestState.__ocsuiteEnsureRlsRolePromise = undefined;
      throw error;
    });
  }

  return globalTestState.__ocsuiteEnsureRlsRolePromise;
}

const TENANT_SCOPED_TABLES: Array<keyof PrismaClient> = [
  'notification',
  'actionApproval',
  'boardActionItem',
  'boardPersonaTurn',
  'boardMeeting',
  'message',
  'conversation',
  'task',
  'analyticsSnapshot',
  'moduleInsight',
  'connector',
  'usageSnapshot',
  'knowledgeEntry',
  'businessProfile',
];

const BASE_ENTITY_TABLES: Array<keyof PrismaClient> = [
  'tenantMember',
  'user',
  'tenant',
];

interface CleanupOptions {
  includeBase?: boolean;
}

// Test tenant IDs
export const TENANT_1_ID = 'test-tenant-1';
export const TENANT_2_ID = 'test-tenant-2';

// Test user IDs
export const USER_1_ID = 'test-user-1';
export const USER_2_ID = 'test-user-2';

/**
 * Clean up all test data
 */
export async function cleanupTestData(options: CleanupOptions = {}) {
  const { includeBase = false } = options;
  const deletions: Array<{ name: keyof PrismaClient; op: (client: TxClient) => Promise<unknown> }> = [
    ...TENANT_SCOPED_TABLES.map((table) => ({
      name: table,
      op: (client: TxClient) => (client[table] as any).deleteMany(),
    })),
    ...(includeBase
      ? BASE_ENTITY_TABLES.map((table) => ({
          name: table,
          op: (client: TxClient) => (client[table] as any).deleteMany(),
        }))
      : []),
  ];

  await withDisabledRowSecurity(async (client) => {
    for (const { name, op } of deletions) {
      try {
        await op(client);
      } catch (error) {
        if (process.env.DEBUG_PRISMA_TESTS === 'true') {
          console.debug(`cleanupTestData: skipped ${String(name)}`, error);
        }
      }
    }
  });
}

/**
 * Seed test data with two tenants and users
 */
export async function seedTestData() {
  await withDisabledRowSecurity(async (client) => {
    await client.tenant.createMany({
      data: [
        {
          id: TENANT_1_ID,
          name: 'Test Tenant 1',
          slug: 'test-tenant-1',
        },
        {
          id: TENANT_2_ID,
          name: 'Test Tenant 2',
          slug: 'test-tenant-2',
        },
      ],
      skipDuplicates: true,
    });

    await client.user.createMany({
      data: [
        {
          id: USER_1_ID,
          clerkId: 'clerk-user-1',
          email: 'user1@test.com',
          name: 'Test User 1',
        },
        {
          id: USER_2_ID,
          clerkId: 'clerk-user-2',
          email: 'user2@test.com',
          name: 'Test User 2',
        },
      ],
      skipDuplicates: true,
    });

    await client.tenantMember.createMany({
      data: [
        {
          tenantId: TENANT_1_ID,
          userId: USER_1_ID,
          role: 'owner',
        },
        {
          tenantId: TENANT_2_ID,
          userId: USER_2_ID,
          role: 'owner',
        },
      ],
      skipDuplicates: true,
    });
  });
}

beforeAll(async () => {
  await ensureRlsTestRole();
  await cleanupTestData({ includeBase: true });
  await seedTestData();
}, 120000);

/**
 * Clean up after each test to ensure isolation
 */
beforeEach(async () => {
  await cleanupTestData();
}, 60000);

/**
 * Global test teardown
 */
afterAll(async () => {
  await cleanupTestData({ includeBase: true });
  await testPrisma.$disconnect();
}, 60000);

/**
 * Helper to create test conversations
 */
export async function createTestConversation(
  tenantId: string,
  userId: string,
  personaType: 'ceo' | 'cfo' | 'cmo' | 'cto' = 'ceo',
  title?: string
) {
  return testPrisma.conversation.create({
    data: {
      tenantId,
      userId,
      personaType,
      title: title || `Test Conversation ${Date.now()}`,
    },
  });
}

/**
 * Helper to create test messages
 */
export async function createTestMessage(
  conversationId: string,
  tenantId: string,
  content: string,
  role: 'user' | 'assistant' | 'system' = 'user'
) {
  return testPrisma.message.create({
    data: {
      conversationId,
      tenantId,
      role,
      content,
    },
  });
}

/**
 * Helper to create test tasks
 */
export async function createTestTask(
  tenantId: string,
  userId: string,
  type: string = 'test-task',
  status: 'pending' | 'running' | 'completed' | 'failed' = 'pending'
) {
  return testPrisma.task.create({
    data: {
      tenantId,
      userId,
      type,
      status,
      priority: 'normal',
      payload: { test: true },
    },
  });
}

/**
 * Helper to create test action approvals
 */
export async function createTestActionApproval(
  tenantId: string,
  overrides: Partial<Prisma.ActionApprovalUncheckedCreateInput> = {}
) {
  const data: Prisma.ActionApprovalUncheckedCreateInput = {
    tenantId,
    source: 'board-orchestrator',
    payload: { action: 'send-email', scope: 'sales' },
    riskScore: 42,
    status: 'pending',
    createdBy: USER_1_ID,
    auditLog: [{ event: 'submitted', at: new Date().toISOString() }],
  } as Prisma.ActionApprovalUncheckedCreateInput;

  Object.assign(data, overrides);

  if (!data.auditLog) {
    data.auditLog = [{ event: 'submitted', at: new Date().toISOString() }];
  }

  return testPrisma.actionApproval.create({
    data,
  });
}

/**
 * Helper to create test notifications
 */
export async function createTestNotification(
  tenantId: string,
  userId: string,
  overrides: Partial<Prisma.NotificationUncheckedCreateInput> = {}
) {
  const data: Prisma.NotificationUncheckedCreateInput = {
    tenantId,
    userId,
    type: 'approval_requested',
    payload: { message: 'New approval request' },
    channel: 'in_app',
  };

  Object.assign(data, overrides);

  if (!data.payload) {
    data.payload = { message: 'New approval request' };
  }

  if (!data.type) {
    data.type = 'approval_requested';
  }

  if (!data.channel) {
    data.channel = 'in_app';
  }

  return testPrisma.notification.create({
    data,
  });
}

/**
 * Helper to create test connectors
 */
export async function createTestConnector(
  tenantId: string,
  provider: 'google' | 'gmail' | 'slack' | 'notion' | 'stripe' = 'google',
  status: 'active' | 'error' | 'disconnected' | 'pending' = 'active'
) {
  return testPrisma.connector.create({
    data: {
      tenantId,
      provider,
      status,
      encryptedAccessToken: 'encrypted-token',
      scopes: ['read', 'write'],
    },
  });
}

/**
 * Helper to create test knowledge entries
 */
export async function createTestKnowledgeEntry(
  tenantId: string | null,
  source: string = 'test-source',
  content: string = 'Test knowledge content',
  sourceId?: string | null
) {
  return testPrisma.knowledgeEntry.create({
    data: {
      tenantId,
      source,
      content,
      metadata: { test: true },
      sourceId: sourceId ?? null,
    },
  });
}

export async function createTestKnowledgeSource(
  tenantId: string | null,
  name = 'Test Source',
  type: 'file_upload' | 'cloud_sync' | 'manual_note' | 'hq_share' = 'file_upload',
  provider: 'upload' | 'google_drive' | 'notion' | 'manual' | 'hq' | 'other' = 'upload',
  status: 'pending' | 'syncing' | 'ready' | 'error' | 'disabled' = 'ready'
) {
  return testPrisma.knowledgeSource.create({
    data: {
      tenantId,
      name,
      type,
      provider,
      status,
      storageStrategy: tenantId ? 'managed_postgres' : 'external_s3',
      retentionPolicy: 'retain_indefinitely',
      configuration: { example: true },
    },
  });
}

/**
 * Helper to count records in a table
 */
export async function countRecords(model: string): Promise<number> {
  const result = await (testPrisma as any)[model].count();
  return result;
}

/**
 * Helper to create test module insights
 */
export async function createTestModuleInsight(
  tenantId: string,
  moduleSlug: string = 'growth-pulse',
  severity: string = 'info',
  summary: string = 'Test insight summary',
  score?: number
) {
  return testPrisma.moduleInsight.create({
    data: {
      tenantId,
      moduleSlug,
      severity,
      summary,
      highlights: ['Highlight 1', 'Highlight 2'],
      actionItems: {
        items: [
          { title: 'Action 1', priority: 'high' },
          { title: 'Action 2', priority: 'medium' },
        ],
      },
      score,
      metadata: { test: true },
    },
  });
}

/**
 * Helper to create test analytics snapshots
 */
export async function createTestAnalyticsSnapshot(
  tenantId: string,
  date: Date,
  connectorId?: string,
  sessions: number = 100,
  users: number = 50,
  conversions: number = 10,
  revenue: number = 1000.0
) {
  return testPrisma.analyticsSnapshot.create({
    data: {
      tenantId,
      connectorId,
      date,
      sessions,
      users,
      conversions,
      revenue,
      sourceBreakdown: {
        organic: 40,
        paid: 30,
        direct: 20,
        referral: 10,
      },
      metadata: { test: true },
    },
  });
}

/**
 * Helper to create test board meetings
 */
export async function createTestBoardMeeting(
  tenantId: string,
  overrides: Partial<Prisma.BoardMeetingUncheckedCreateInput> = {}
) {
  const data: Prisma.BoardMeetingUncheckedCreateInput = {
    tenantId,
    agenda: { sections: ['Strategy Review', 'Key Metrics'] },
    agendaVersion: 1,
    startedAt: new Date(),
  };

  Object.assign(data, overrides);

  if (!data.agenda) {
    data.agenda = { sections: ['Strategy Review', 'Key Metrics'] };
  }

  if (!data.startedAt) {
    data.startedAt = new Date();
  }

  if (!data.agendaVersion) {
    data.agendaVersion = 1;
  }

  return testPrisma.boardMeeting.create({
    data,
  });
}

/**
 * Helper to create test persona turns
 */
export async function createTestBoardPersonaTurn(
  tenantId: string,
  meetingId: string,
  overrides: Partial<Prisma.BoardPersonaTurnUncheckedCreateInput> = {}
) {
  const data: Prisma.BoardPersonaTurnUncheckedCreateInput = {
    tenantId,
    meetingId,
    persona: 'cto',
    role: 'cto',
    content: 'Test persona turn content',
    sequence: 1,
    streamedAt: new Date(),
  };

  Object.assign(data, overrides);

  if (!data.persona) {
    data.persona = 'cto';
  }

  if (!data.sequence) {
    data.sequence = 1;
  }

  if (!data.streamedAt) {
    data.streamedAt = new Date();
  }

  if (!data.content) {
    data.content = 'Test persona turn content';
  }

  return testPrisma.boardPersonaTurn.create({
    data,
  });
}

/**
 * Helper to create test board action items
 */
export async function createTestBoardActionItem(
  tenantId: string,
  meetingId: string,
  overrides: Partial<Prisma.BoardActionItemUncheckedCreateInput> = {}
) {
  const data: Prisma.BoardActionItemUncheckedCreateInput = {
    tenantId,
    meetingId,
    title: 'Test board action item',
    status: 'open',
    priority: 'normal',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  Object.assign(data, overrides);

  if (!data.title) {
    data.title = 'Test board action item';
  }

  if (!data.status) {
    data.status = 'open';
  }

  if (!data.priority) {
    data.priority = 'normal';
  }

  return testPrisma.boardActionItem.create({
    data,
  });
}
