# Quick Start Guide

Get up and running with @ocsuite/db in 5 minutes.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ with pgvector extension
- pnpm 8+

## Installation

```bash
cd packages/db
pnpm install
```

## Database Setup

### 1. Start PostgreSQL

Using Docker:

```bash
docker run --name ocsuite-postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=ocsuite_dev \
  -p 5432:5432 \
  -d ankane/pgvector
```

Or use your existing PostgreSQL instance.

### 2. Enable pgvector Extension

```bash
psql -U postgres -d ocsuite_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/ocsuite_dev?schema=public"
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/ocsuite_test?schema=public"
```

### 4. Run Migrations

```bash
pnpm migrate:dev
```

This will:
- Create all tables
- Enable Row-Level Security
- Set up RLS policies
- Generate Prisma client

## Basic Usage

### Create a Tenant-Scoped Client

```typescript
import { createTenantClient } from '@ocsuite/db';

const db = createTenantClient({
  tenantId: 'tenant-123',
  userId: 'user-456',
});

// All queries are automatically scoped to tenant-123
const conversations = await db.conversation.findMany();
```

### Create Data

```typescript
const conversation = await db.conversation.create({
  data: {
    userId: 'user-456',
    personaType: 'ceo',
    title: 'Strategic Planning',
  },
});

const message = await db.message.create({
  data: {
    conversationId: conversation.id,
    role: 'user',
    content: 'What are our Q1 priorities?',
  },
});
```

### Query Data

```typescript
// Find specific conversation
const conv = await db.conversation.findUnique({
  where: { id: 'conv-id' },
  include: { messages: true },
});

// Find all pending tasks
const tasks = await db.task.findMany({
  where: { status: 'pending' },
  orderBy: { priority: 'desc' },
  take: 10,
});

// Count conversations
const count = await db.conversation.count();
```

### Update Data

```typescript
await db.conversation.update({
  where: { id: 'conv-id' },
  data: { title: 'Updated Title' },
});
```

### Delete Data

```typescript
await db.task.delete({
  where: { id: 'task-id' },
});
```

## Next.js API Route Example

```typescript
// app/api/conversations/route.ts
import { createTenantClient } from '@ocsuite/db';
import { auth } from '@clerk/nextjs';
import { NextResponse } from 'next/server';

export async function GET() {
  const { userId } = auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get tenant from user context (implement this)
  const tenantId = await getUserTenantId(userId);

  const db = createTenantClient({ tenantId, userId });

  try {
    const conversations = await db.conversation.findMany({
      include: { messages: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ conversations });
  } finally {
    await db.$disconnect();
  }
}

export async function POST(req: Request) {
  const { userId } = auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { title, personaType } = await req.json();
  const tenantId = await getUserTenantId(userId);

  const db = createTenantClient({ tenantId, userId });

  try {
    const conversation = await db.conversation.create({
      data: {
        userId,
        personaType,
        title,
      },
    });

    return NextResponse.json({ conversation });
  } finally {
    await db.$disconnect();
  }
}
```

## Testing

### Run Tests

```bash
pnpm test
```

### Test Specific File

```bash
pnpm test middleware.test.ts
```

### Test with Coverage

```bash
pnpm test:coverage
```

## Verify Tenant Isolation

### Test in Code

```typescript
import { createTenantClient } from '@ocsuite/db';

// Create data as tenant 1
const db1 = createTenantClient({ tenantId: 'tenant-1', userId: 'user-1' });
await db1.conversation.create({
  data: {
    userId: 'user-1',
    personaType: 'ceo',
    title: 'Tenant 1 Conversation',
  },
});

// Try to access as tenant 2
const db2 = createTenantClient({ tenantId: 'tenant-2', userId: 'user-2' });
const conversations = await db2.conversation.findMany();

console.log(conversations.length); // 0 - tenant 2 can't see tenant 1 data
```

### Test in Database

```sql
-- Set tenant context
SET LOCAL app.current_tenant_id = 'tenant-1';

-- This only shows tenant 1 data
SELECT * FROM conversations;

-- Switch tenant
SET LOCAL app.current_tenant_id = 'tenant-2';

-- This only shows tenant 2 data
SELECT * FROM conversations;
```

## Common Operations

### Create User and Tenant

```typescript
import { prisma } from '@ocsuite/db';

// Create tenant
const tenant = await prisma.tenant.create({
  data: {
    name: 'Acme Corp',
    slug: 'acme-corp',
  },
});

// Create user
const user = await prisma.user.create({
  data: {
    clerkId: 'clerk-user-123',
    email: 'user@acme.com',
    name: 'John Doe',
  },
});

// Add user to tenant
await prisma.tenantMember.create({
  data: {
    tenantId: tenant.id,
    userId: user.id,
    role: 'owner',
  },
});
```

### Query with Relations

```typescript
const db = createTenantClient({ tenantId, userId });

const conversations = await db.conversation.findMany({
  include: {
    messages: {
      orderBy: { createdAt: 'asc' },
      take: 50,
    },
    user: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
  },
});
```

### Pagination

```typescript
const db = createTenantClient({ tenantId, userId });

const page = 1;
const pageSize = 20;

const [conversations, total] = await Promise.all([
  db.conversation.findMany({
    take: pageSize,
    skip: (page - 1) * pageSize,
    orderBy: { createdAt: 'desc' },
  }),
  db.conversation.count(),
]);

console.log(`Page ${page} of ${Math.ceil(total / pageSize)}`);
```

## Troubleshooting

### Error: "Tenant context required"

You forgot to create a tenant-scoped client:

```typescript
// ❌ Wrong
import { prisma } from '@ocsuite/db';
await prisma.conversation.findMany();

// ✅ Correct
import { createTenantClient } from '@ocsuite/db';
const db = createTenantClient({ tenantId, userId });
await db.conversation.findMany();
```

### Error: "relation does not exist"

Run migrations:

```bash
pnpm migrate:dev
```

### Tests Failing

Make sure you have a test database:

```bash
# Create test database
createdb ocsuite_test

# Run migrations on test database
DATABASE_URL="postgresql://postgres:password@localhost:5432/ocsuite_test" pnpm migrate:dev
```

## Next Steps

- Read [README.md](./README.md) for full documentation
- Review [SECURITY.md](./SECURITY.md) for security architecture
- Check [tests/](./tests/) for usage examples
- Explore Prisma schema in [prisma/schema.prisma](./prisma/schema.prisma)

## Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Multi-Tenant Best Practices](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/overview)
