# Architecture Documentation

## Overview

@ocsuite/db is a multi-tenant database package built on Prisma ORM with PostgreSQL Row-Level Security (RLS) for bulletproof tenant isolation.

## Design Principles

1. **Security First**: Defense-in-depth with middleware and RLS
2. **Type Safety**: Full TypeScript support with Prisma types
3. **Developer Experience**: Simple API, automatic tenant scoping
4. **Performance**: Optimized indexes and query patterns
5. **Compliance**: GDPR, HIPAA, SOC 2 compatible

## Directory Structure

```
packages/db/
├── src/
│   ├── index.ts          # Main exports and client creation
│   ├── middleware.ts     # Tenant isolation middleware
│   └── types.ts          # Type utilities
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── migrations/       # Database migrations
│       ├── 20240101000000_init/
│       │   └── migration.sql           # Initial schema
│       └── 20240101000001_add_rls_policies/
│           └── migration.sql           # RLS policies
├── tests/
│   ├── setup.ts          # Test configuration
│   ├── middleware.test.ts # Middleware tests
│   └── rls.test.ts       # RLS policy tests
├── scripts/
│   └── test-rls.sql      # Manual RLS testing
├── README.md             # Full documentation
├── QUICKSTART.md         # Getting started guide
├── SECURITY.md           # Security architecture
├── ARCHITECTURE.md       # This file
├── package.json          # Package configuration
├── tsconfig.json         # TypeScript config
├── vitest.config.ts      # Test configuration
└── .env.example          # Environment template
```

## Core Components

### 1. Prisma Schema

**File**: `prisma/schema.prisma`

Defines the database schema with:
- **Global Models**: `Tenant`, `User` (no tenant isolation)
- **Tenant-Scoped Models**: All other models with `tenantId` field
- **Indexes**: All `tenantId` fields are indexed
- **Relations**: Proper foreign keys with CASCADE deletes
- **Extensions**: pgvector for embeddings

**Design Decisions**:
- Use `cuid()` for IDs (collision-resistant, URL-safe)
- Use `@updatedAt` for automatic timestamp tracking
- Use enums for status fields (type-safe, indexed)
- Use JSONB for flexible metadata
- Use `BigInt` for storage metrics (handles large values)

### 2. Tenant Isolation Middleware

**File**: `src/middleware.ts`

**Purpose**: Automatically inject `tenantId` into all queries

**How It Works**:
```typescript
const middleware = (params, next) => {
  // 1. Check if model requires tenant isolation
  if (isTenantScopedModel(params.model)) {
    // 2. Validate tenant context exists
    if (!context.tenantId) throw TenantContextError();

    // 3. Inject tenantId into query
    params.args.where.tenantId = context.tenantId;
  }

  // 4. Execute query
  return next(params);
};
```

**Supported Operations**:
- `findUnique`, `findFirst`, `findMany`
- `create`, `update`, `updateMany`
- `delete`, `deleteMany`
- `upsert`, `count`

**Special Cases**:
- `KnowledgeEntry`: Allows `tenantId = null` for company-wide data
- Global models (`Tenant`, `User`): No middleware applied

### 3. Row-Level Security Policies

**File**: `prisma/migrations/20240101000001_add_rls_policies/migration.sql`

**Purpose**: Database-level enforcement of tenant isolation

**How It Works**:
```sql
-- Enable RLS on table
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "conversations_tenant_isolation_select"
  ON conversations
  FOR SELECT
  USING ("tenantId" = current_setting('app.current_tenant_id', true)::text);
```

**Session Variable**:
```typescript
await prisma.$executeRaw`
  SET LOCAL app.current_tenant_id = ${tenantId}
`;
```

**Benefits**:
- Cannot be bypassed by application
- Protects raw SQL queries
- Works even if middleware disabled
- Industry standard for multi-tenancy

### 4. Client API

**File**: `src/index.ts`

**Primary Function**: `createTenantClient(context)`

```typescript
export function createTenantClient(context: TenantContext): PrismaClient {
  const client = new PrismaClient();
  applyMiddlewares(client, context);
  return client;
}
```

**Helper Functions**:
- `setRLSTenantContext()`: Set RLS session variable
- `clearRLSTenantContext()`: Clear RLS session variable
- `withTenantContext()`: Execute callback with RLS context
- `checkDatabaseHealth()`: Health check utility
- `disconnectDatabase()`: Graceful shutdown

**Global Client**: `prisma` (use only for system operations)

## Data Flow

### Query Flow (with Middleware)

```
1. User calls db.conversation.findMany()
2. Middleware intercepts query
3. Validates tenantId exists in context
4. Injects WHERE tenantId = 'tenant-123'
5. Query executes: SELECT * FROM conversations WHERE tenantId = 'tenant-123'
6. RLS policy validates session variable matches
7. Results returned to user
```

### Query Flow (with RLS)

```
1. User calls prisma.$queryRaw`SELECT * FROM conversations`
2. No middleware (raw query)
3. Query executes with session variable set
4. RLS policy checks: tenantId = current_setting('app.current_tenant_id')
5. Only matching rows returned
```

## Database Schema

### Global Tables (No Tenant Isolation)

#### tenants
- Primary entity representing an organization
- Has one `BusinessProfile`
- Has many `TenantMembers`, `Conversations`, etc.

#### users
- Application users
- Can belong to multiple tenants via `TenantMembers`
- Stores Clerk authentication ID

### Tenant-Scoped Tables

#### tenant_members
- Join table linking Users to Tenants
- Stores role: `owner`, `admin`, `member`

#### conversations
- Chat conversations with AI personas
- Belongs to Tenant and User
- Has many Messages

#### messages
- Individual chat messages
- Belongs to Conversation and Tenant
- Stores role: `user`, `assistant`, `system`

#### connectors
- Third-party integrations
- Unique per (tenant, provider) pair
- Stores encrypted tokens

#### tasks
- Background jobs and async operations
- Belongs to Tenant and User
- Tracks status and priority

#### usage_snapshots
- Daily usage metrics
- Unique per (tenant, date) pair
- Aggregates API calls, tokens, storage

#### knowledge_entries
- Vector embeddings for RAG
- Can be tenant-specific OR company-wide (`tenantId = null`)
- Uses pgvector for similarity search

#### business_profiles
- Tenant business information
- One per tenant
- Stores industry, size, stage, goals

## Performance Optimization

### Indexes

All `tenantId` columns are indexed:
```sql
CREATE INDEX "conversations_tenantId_idx" ON "conversations"("tenantId");
```

Additional composite indexes:
```sql
CREATE INDEX "conversations_tenantId_createdAt_idx"
  ON "conversations"("tenantId", "createdAt" DESC);
```

### Query Patterns

**Efficient**:
```typescript
// Uses index on tenantId
const conversations = await db.conversation.findMany({
  where: { status: 'active' },
  orderBy: { createdAt: 'desc' },
  take: 20,
});
```

**Inefficient**:
```typescript
// Full table scan, then filter
const all = await db.conversation.findMany();
const filtered = all.filter(c => c.status === 'active');
```

### Connection Pooling

Use PgBouncer in production:
```env
DATABASE_URL="postgresql://user:pass@pgbouncer:6432/db?pgbouncer=true"
```

Recommended pool size:
- Development: 5-10 connections
- Production: (2 * cores) + effective_spindle_count

## Testing Strategy

### Unit Tests

**Middleware Tests** (`tests/middleware.test.ts`):
- Test basic tenant isolation
- Test cross-tenant access prevention
- Test all query operations
- Test special cases (KnowledgeEntry)

**RLS Tests** (`tests/rls.test.ts`):
- Test SELECT/INSERT/UPDATE/DELETE policies
- Test raw SQL queries
- Test session variable handling
- Test combined middleware + RLS

### Integration Tests

- Test with real PostgreSQL database
- Use separate test database
- Clean up between tests
- Seed predictable test data

### Manual Testing

SQL script (`scripts/test-rls.sql`):
- Create test tenants and data
- Test each RLS policy manually
- Verify cross-tenant blocking
- Document expected results

## Security Considerations

### Threat Model

**Threats**:
1. Cross-tenant data access
2. SQL injection
3. Middleware bypass
4. Context manipulation
5. Privilege escalation

**Mitigations**:
1. Middleware + RLS (defense-in-depth)
2. Prisma parameterization + RLS
3. RLS policies as fallback
4. Middleware overwrites user input
5. Separate role checks in app layer

### Best Practices

1. **Never trust client input**: Get `tenantId` from server session
2. **Always use `createTenantClient()`**: For tenant-scoped operations
3. **Set RLS context for raw queries**: Use `withTenantContext()`
4. **Validate authorization**: Check roles before mutations
5. **Audit access patterns**: Log suspicious queries
6. **Test isolation regularly**: Run security tests in CI

## Migration Strategy

### Creating Migrations

```bash
# Create empty migration
pnpm migrate:create

# Apply migrations
pnpm migrate:dev

# Generate client
pnpm generate
```

### Migration Best Practices

1. **Always review generated SQL**: Check for unintended changes
2. **Test migrations on staging**: Before production deployment
3. **Backup before migration**: Always have rollback plan
4. **Add RLS policies for new tables**: If tenant-scoped
5. **Create indexes for performance**: Especially on `tenantId`

### Rolling Back

```bash
# Reset database (DESTRUCTIVE)
pnpm reset

# Manually rollback one migration
psql $DATABASE_URL -f prisma/migrations/<timestamp>_rollback.sql
```

## Monitoring and Observability

### Metrics to Track

1. **Query Performance**: Slow queries > 100ms
2. **Cross-Tenant Attempts**: Failed RLS checks
3. **Context Errors**: Missing tenant context
4. **Connection Pool**: Usage and wait times
5. **Storage Growth**: Per tenant

### Logging

Enable Prisma query logging:
```typescript
const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'],
});
```

Production logging:
```typescript
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('query', (e) => {
  logger.debug('Query', {
    query: e.query,
    duration: e.duration,
    tenantId: getCurrentTenantId(),
  });
});
```

## Future Enhancements

### Planned Features

1. **Audit Logging**: Track all data changes
2. **Field Encryption**: Encrypt PII at rest
3. **Multi-Region**: Data residency support
4. **Read Replicas**: Separate read/write operations
5. **Soft Deletes**: Paranoid mode for compliance
6. **Version History**: Track record changes over time

### Potential Optimizations

1. **Partitioning**: Partition large tables by `tenantId`
2. **Caching**: Redis cache for hot data
3. **Batch Operations**: Bulk insert/update utilities
4. **Query Optimization**: Materialized views for reports
5. **Schema Sync**: Validate schema matches types

## Appendix

### Useful Commands

```bash
# Generate Prisma client
pnpm generate

# Run migrations
pnpm migrate:dev

# Push schema (skip migrations)
pnpm push

# Open Prisma Studio
pnpm studio

# Run tests
pnpm test

# Type check
pnpm typecheck
```

### Common Errors

**Error**: `P2002: Unique constraint failed`
- **Cause**: Duplicate key violation
- **Fix**: Check unique fields before insert

**Error**: `P2025: Record not found`
- **Cause**: Trying to update/delete non-existent record
- **Fix**: Check record exists first

**Error**: `Tenant context required`
- **Cause**: Using tenant-scoped model without context
- **Fix**: Use `createTenantClient()` instead of global `prisma`

### References

- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [pgvector Extension](https://github.com/pgvector/pgvector)
- [Multi-Tenant Architectures](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/overview)
