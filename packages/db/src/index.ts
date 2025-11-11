import { PrismaClient, Prisma } from '@prisma/client';
import {
  createTenantMiddleware,
  createAuditMiddleware,
  applyMiddlewares,
  type TenantContext,
  TenantContextError,
} from './middleware.js';

// Re-export Prisma types for convenience
export * from '@prisma/client';
export { Prisma };

// Export middleware utilities
export {
  createTenantMiddleware,
  createAuditMiddleware,
  applyMiddlewares,
  TenantContextError,
  type TenantContext,
};

// Export custom types
export * from './types.js';

/**
 * Cached tenant-scoped Prisma clients keyed by tenantId
 * Helps avoid creating a new PrismaClient per request while
 * still respecting tenant isolation middleware.
 */
const tenantClientCache = new Map<string, PrismaClient>();

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Global Prisma client instance (without middleware)
 * Use this only for system-level operations that don't require tenant isolation
 *
 * WARNING: Direct use of this client bypasses tenant isolation.
 * Only use for:
 * - User authentication and lookup
 * - Tenant creation and management
 * - System-level operations
 *
 * For tenant-scoped operations, always use createTenantClient()
 */
export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
});

/**
 * Retrieve a Prisma client based on tenant context.
 *
 * Without a tenantId this returns the shared global client which
 * is suitable for system-level tables (e.g. User, Tenant).
 * With a tenantId we lazily create or reuse a tenant-scoped client
 * with isolation middleware applied.
 */
export function getTenantDb(tenantId?: string, userId?: string): PrismaClient {
  if (!tenantId) {
    return prisma;
  }

  const cacheKey = `${tenantId}:${userId ?? 'system'}`;
  const existingClient = tenantClientCache.get(cacheKey);
  if (existingClient) {
    return existingClient;
  }

  const tenantClient = createTenantClient({ tenantId, userId });
  tenantClientCache.set(cacheKey, tenantClient);
  return tenantClient;
}

/**
 * Creates a tenant-scoped Prisma client with middleware applied
 *
 * This is the primary way to interact with the database in a multi-tenant context.
 * All queries will be automatically scoped to the provided tenant.
 *
 * @param context - Tenant context containing tenantId and optional userId
 * @returns PrismaClient with tenant isolation middleware
 *
 * @example
 * ```ts
 * // In an API route with authenticated user
 * const db = createTenantClient({
 *   tenantId: user.tenantId,
 *   userId: user.id,
 * });
 *
 * // All queries are automatically scoped to the tenant
 * const conversations = await db.conversation.findMany();
 * const tasks = await db.task.findMany({ where: { status: 'pending' } });
 * ```
 */
export function createTenantClient(context: TenantContext): PrismaClient {
  // Create a new client instance for this tenant context
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

  // Apply tenant isolation and audit middlewares
  applyMiddlewares(client, context);

  return client;
}

/**
 * Utility function to set RLS session variable
 *
 * Use this in combination with raw queries or when you need to set
 * the tenant context at the database session level for RLS policies.
 *
 * @param client - PrismaClient instance
 * @param tenantId - Tenant ID to set in session
 *
 * @example
 * ```ts
 * await setRLSTenantContext(prisma, 'tenant-123');
 *
 * // Now RLS policies will enforce tenant isolation
 * // even for raw queries
 * await prisma.$queryRaw`SELECT * FROM conversations`;
 * ```
 */
type PrismaDbClient = PrismaClient | Prisma.TransactionClient;
type TransactionOptions = Parameters<PrismaClient['$transaction']>[1];

interface RLSOptions {
  isLocal?: boolean;
}

export async function setRLSTenantContext(
  client: PrismaDbClient,
  tenantId: string,
  options: RLSOptions = {}
): Promise<void> {
  const isLocal = options.isLocal ?? false;
  await client.$executeRaw`
    SELECT pg_catalog.set_config('app.current_tenant_id', ${tenantId}, ${isLocal})
  `;
}

/**
 * Utility function to clear RLS session variable
 *
 * @param client - PrismaClient instance
 */
export async function clearRLSTenantContext(
  client: PrismaDbClient,
  options: RLSOptions = {}
): Promise<void> {
  const isLocal = options.isLocal ?? false;
  await client.$executeRaw`
    SELECT pg_catalog.set_config('app.current_tenant_id', '', ${isLocal})
  `;
}

/**
 * Helper function to execute a query within a tenant context
 *
 * This function:
 * 1. Sets the RLS tenant context
 * 2. Executes the provided callback
 * 3. Clears the RLS context (even if callback throws)
 *
 * Useful for one-off operations or batch jobs that need RLS enforcement.
 *
 * @param client - PrismaClient instance
 * @param tenantId - Tenant ID for context
 * @param callback - Async function to execute within tenant context
 * @returns Result of the callback
 *
 * @example
 * ```ts
 * const result = await withTenantContext(prisma, 'tenant-123', async (tx) => {
 *   // Both middleware and RLS will enforce tenant isolation
 *   const conversations = await tx.conversation.findMany();
 *   return conversations.length;
 * });
 * ```
 */
export async function withTenantContext<T>(
  client: PrismaClient,
  tenantId: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      const enforcedRole = process.env.RLS_ENFORCED_ROLE?.trim();
      if (enforcedRole) {
        await tx.$executeRawUnsafe(
          `SET LOCAL ROLE ${quoteIdentifier(enforcedRole)}`
        );
      }

      await tx.$executeRawUnsafe('SET LOCAL row_security = on');
      await setRLSTenantContext(tx, tenantId, { isLocal: true });
      try {
        return await callback(tx);
      } finally {
        await clearRLSTenantContext(tx, { isLocal: true });
        if (enforcedRole) {
          await tx.$executeRawUnsafe('RESET ROLE');
        }
      }
    },
    options
  );
}

/**
 * Health check utility
 *
 * Verifies database connectivity and returns connection status
 *
 * @returns Promise<boolean> true if database is accessible
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

/**
 * Gracefully disconnect all Prisma clients
 *
 * Call this during application shutdown to ensure clean database
 * connection cleanup.
 */
export async function disconnectDatabase(): Promise<void> {
  await Promise.all(
    Array.from(tenantClientCache.values(), (client) => client.$disconnect())
  );
  tenantClientCache.clear();
  await prisma.$disconnect();
}

// Handle cleanup on process termination
if (typeof process !== 'undefined') {
  process.on('beforeExit', () => {
    disconnectDatabase().catch(console.error);
  });
}
