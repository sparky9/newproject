# @ocsuite/db

Multi-tenant PostgreSQL database package with Prisma ORM, Row-Level Security (RLS) policies, and bulletproof tenant isolation middleware.

## Features

- **Multi-Tenant Architecture**: Built-in tenant isolation at both application and database levels
- **Row-Level Security**: PostgreSQL RLS policies provide defense-in-depth protection
- **Type-Safe**: Full TypeScript support with Prisma generated types
- **Audit Trail**: Automatic timestamp tracking and extensible audit middleware
- **pgvector Support**: Vector embeddings for AI/ML features
- **Comprehensive Testing**: Extensive test suite covering all isolation scenarios

## Security Architecture

This package implements a **defense-in-depth** security strategy with two layers:

### Layer 1: Application Middleware

Prisma middleware automatically injects `tenantId` into all queries, preventing accidental cross-tenant data access.

### Layer 2: Database RLS Policies

PostgreSQL Row-Level Security policies enforce tenant isolation at the database level, even if application middleware is bypassed.

This dual-layer approach ensures:

- No cross-tenant data leakage
- Protection against SQL injection
- Defense against middleware bugs or bypasses
- Compliance with data isolation requirements

## Installation

```bash
pnpm install
```

## Setup

1. **Create `.env` file**:

```bash
cp .env.example .env
```

Edit `.env` with your database credentials:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/ocsuite_dev?schema=public"
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/ocsuite_test?schema=public"
```

2. **Install PostgreSQL extensions**:

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
```

3. **Run migrations**:

```bash
pnpm migrate:dev
```

4. **Generate Prisma client**:

```bash
pnpm generate
```

5. **Seed demo data (optional)**:

```bash
pnpm seed:slice3   # Board meeting + persona turns
pnpm seed:slice4   # Action approvals + notifications
```

## Usage

### Basic Usage

```typescript
import { createTenantClient } from "@ocsuite/db";

// Create a tenant-scoped client
const db = createTenantClient({
  tenantId: "tenant-123",
  userId: "user-456",
});

// All queries are automatically scoped to tenant-123
const conversations = await db.conversation.findMany();
const tasks = await db.task.findMany({ where: { status: "pending" } });

// Don't forget to disconnect when done
await db.$disconnect();
```

### API Route Example (Next.js)

```typescript
import { createTenantClient } from "@ocsuite/db";
import { auth } from "@clerk/nextjs";

export async function GET(req: Request) {
  const { userId } = auth();

  // Get tenantId from user's session/context
  const tenantId = await getUserTenantId(userId);

  // Create tenant-scoped client
  const db = createTenantClient({ tenantId, userId });

  try {
    // Query data - automatically scoped to tenant
    const data = await db.conversation.findMany({
      include: { messages: true },
    });

    return Response.json({ data });
  } finally {
    await db.$disconnect();
  }
}
```

### System Operations (No Tenant Context)

For system-level operations like user authentication or tenant management, use the global client:

```typescript
import { prisma } from "@ocsuite/db";

// Global operations (use sparingly!)
const user = await prisma.user.findUnique({
  where: { clerkId: "clerk-user-id" },
});

const tenant = await prisma.tenant.create({
  data: {
    name: "Acme Corp",
    slug: "acme-corp",
  },
});
```

**WARNING**: The global `prisma` client bypasses tenant isolation. Only use it for:

- User authentication and lookup
- Tenant creation and management
- System-level operations

### Working with RLS Policies

Set the RLS context for raw queries:

```typescript
import {
  prisma,
  setRLSTenantContext,
  clearRLSTenantContext,
} from "@ocsuite/db";

// Set RLS context
await setRLSTenantContext(prisma, "tenant-123");

// Now raw queries respect RLS policies
const results = await prisma.$queryRaw`
  SELECT * FROM conversations WHERE status = 'active'
`;

// Clear context when done
await clearRLSTenantContext(prisma);
```

Or use the helper function:

```typescript
import { withTenantContext, prisma } from "@ocsuite/db";

const results = await withTenantContext(prisma, "tenant-123", async (tx) => {
  // Both middleware and RLS enforce tenant isolation
  return tx.conversation.findMany();
});
```

### Knowledge Entries (Special Case)

Knowledge entries can be either tenant-specific or company-wide:

```typescript
const db = createTenantClient({ tenantId: "tenant-123", userId: "user-456" });

// Create tenant-specific knowledge
await db.knowledgeEntry.create({
  data: {
    source: "company-docs",
    content: "Tenant-specific information",
    // tenantId is automatically injected
  },
});

// Create company-wide knowledge
await db.knowledgeEntry.create({
  data: {
    tenantId: null, // Explicitly set to null
    source: "global-docs",
    content: "Company-wide information",
  },
});

// Query both tenant-specific and company-wide knowledge
const entries = await db.knowledgeEntry.findMany();
// Returns both tenant-123 entries and null (company-wide) entries
```

## Database Schema

### Core Models

- **Tenant**: Organization/company
- **User**: Application users
- **TenantMember**: User membership in tenants with roles

### Tenant-Scoped Models

All these models require `tenantId` and are automatically isolated:

#### Phase 1 Models

- **Conversation**: Chat conversations with AI personas
- **Message**: Chat messages
- **Connector**: Third-party integrations (Google, Slack, etc.)
- **Task**: Background jobs and async operations
- **UsageSnapshot**: Daily usage metrics and billing data
- **KnowledgeEntry**: Vector embeddings for RAG (can be tenant-specific or company-wide)
- **BusinessProfile**: Tenant business information

#### Phase 2 Models

- **ModuleInsight**: Insights generated by dashboard modules (growth-pulse, churn-watch, etc.)
- **AnalyticsSnapshot**: Daily analytics data snapshots (sessions, users, conversions, revenue)

## Migration Management

### Create a new migration

```bash
pnpm migrate:create
```

### Apply migrations (development)

```bash
pnpm migrate:dev
```

### Apply migrations (production)

```bash
pnpm migrate
```

### Push schema without migration

```bash
pnpm push
```

### Reset database (DESTRUCTIVE)

```bash
pnpm reset
```

## Testing

### Run tests

```bash
pnpm test
```

### Run tests in watch mode

```bash
pnpm test:watch
```

### Run tests with coverage

```bash
pnpm test:coverage
```

### Test Requirements

Tests require a PostgreSQL database. Set `TEST_DATABASE_URL` in `.env`:

```env
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/ocsuite_test?schema=public"
```

**IMPORTANT**: Use a separate test database to avoid corrupting development data.

## Testing Tenant Isolation

The package includes comprehensive tests for:

1. **Middleware Tests** (`tests/middleware.test.ts`):
   - Basic tenant isolation
   - Cross-tenant access prevention
   - Complex queries with relations
   - Special cases (KnowledgeEntry)
   - Upsert and aggregate operations

2. **RLS Tests** (`tests/rls.test.ts`):
   - RLS policy enforcement (Phase 1 tables)
   - SELECT/INSERT/UPDATE/DELETE operations
   - Raw SQL queries with RLS
   - Performance with large datasets
   - Combined middleware + RLS

3. **Phase 2 RLS Tests** (`tests/rls-phase2.test.ts`):
   - ModuleInsight RLS policy enforcement
   - AnalyticsSnapshot RLS policy enforcement
   - Connector relationship handling
   - Unique constraints per tenant
   - Cross-phase RLS integration

### Manual RLS Testing

Test RLS policies directly in PostgreSQL:

```sql
-- Set tenant context
SET LOCAL app.current_tenant_id = 'tenant-123';

-- This should only return tenant-123 data
SELECT * FROM conversations;

-- This should fail (wrong tenant)
INSERT INTO conversations (id, "tenantId", "userId", "personaType")
VALUES (gen_random_uuid(), 'tenant-456', 'user-789', 'ceo');

-- Clear context
SET LOCAL app.current_tenant_id = NULL;
```

## Architecture Decisions

### Why Two Layers?

1. **Middleware First**: Fast, flexible, and covers 99% of use cases
2. **RLS Second**: Defense-in-depth for security compliance and rare edge cases

### Why Prisma?

- Type-safe database access
- Excellent migration management
- Strong TypeScript integration
- Active community and support

### Why PostgreSQL RLS?

- Database-level enforcement
- Can't be bypassed by application code
- Industry standard for multi-tenancy
- No performance penalty with proper indexing

## Performance Considerations

### Indexes

All `tenantId` columns are indexed for optimal query performance:

```sql
CREATE INDEX "conversations_tenantId_idx" ON "conversations"("tenantId");
CREATE INDEX "messages_tenantId_idx" ON "messages"("tenantId");
-- etc.
```

### Connection Pooling

Use a connection pooler like PgBouncer in production:

```env
DATABASE_URL="postgresql://postgres:password@localhost:6432/ocsuite?schema=public&pgbouncer=true"
```

### Query Optimization

- Use `include` sparingly; prefer `select` for specific fields
- Paginate large result sets with `take` and `skip`
- Use cursor-based pagination for real-time data
- Monitor slow queries with Prisma query logging

## Troubleshooting

### Error: "Tenant context required"

You're trying to query a tenant-scoped model without providing a tenant context:

```typescript
// ❌ Wrong
const db = new PrismaClient();
await db.conversation.findMany(); // Error!

// ✅ Correct
const db = createTenantClient({ tenantId: "tenant-123", userId: "user-456" });
await db.conversation.findMany(); // Works!
```

### Error: "relation does not exist"

Run migrations:

```bash
pnpm migrate:dev
```

### Error: "extension does not exist: vector"

Install the pgvector extension:

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
```

### RLS Policies Not Working

1. Check that RLS is enabled:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

2. Verify session variable is set:

```sql
SHOW app.current_tenant_id;
```

3. Check policy definitions:

```sql
SELECT * FROM pg_policies WHERE tablename = 'conversations';
```

## Contributing

### Adding New Models

1. Add model to `prisma/schema.prisma`
2. Add `tenantId` field with index if tenant-scoped
3. Create migration: `pnpm migrate:create`
4. Add RLS policies in new migration
5. Update middleware if needed (add to `TENANT_SCOPED_MODELS`)
6. Add tests for tenant isolation
7. Update this README

### Code Style

- Use TypeScript strict mode
- Add JSDoc comments for public APIs
- Write tests for new features
- Follow existing patterns

## License

MIT

## Support

For issues and questions, please open a GitHub issue or contact the maintainers.

---

**SECURITY NOTICE**: This package implements critical security features for multi-tenant data isolation. Any changes to middleware, RLS policies, or tenant context handling must be thoroughly tested and reviewed.
