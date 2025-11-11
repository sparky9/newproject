# Security Architecture

This document explains the multi-layered security approach for tenant isolation in @ocsuite/db.

## Overview

The package implements **defense-in-depth** with two independent security layers:

1. **Application Layer**: Prisma middleware
2. **Database Layer**: PostgreSQL Row-Level Security (RLS)

Both layers enforce the same tenant isolation rules, ensuring data protection even if one layer is compromised.

## Layer 1: Prisma Middleware

### How It Works

The `createTenantMiddleware` function intercepts all Prisma queries and automatically:

1. Validates that `tenantId` is present in the context
2. Injects `tenantId` into WHERE clauses for all queries
3. Prevents queries from accessing data outside the current tenant

### Protected Operations

- `findUnique` - Adds `tenantId` to WHERE clause
- `findFirst` - Adds `tenantId` to WHERE clause
- `findMany` - Adds `tenantId` to WHERE clause
- `create` - Injects `tenantId` into data
- `update` - Adds `tenantId` to WHERE clause
- `updateMany` - Adds `tenantId` to WHERE clause
- `delete` - Adds `tenantId` to WHERE clause
- `deleteMany` - Adds `tenantId` to WHERE clause
- `upsert` - Adds `tenantId` to both WHERE and create data
- `count` - Adds `tenantId` to WHERE clause

### Example

```typescript
const db = createTenantClient({ tenantId: 'tenant-123', userId: 'user-456' });

// User writes this:
await db.conversation.findMany();

// Middleware transforms it to:
await db.conversation.findMany({
  where: { tenantId: 'tenant-123' }
});
```

### Limitations

- Does NOT protect raw SQL queries (`$queryRaw`, `$executeRaw`)
- Can be bypassed if middleware is not applied
- Requires correct context to be passed

## Layer 2: PostgreSQL RLS

### How It Works

Row-Level Security is a PostgreSQL feature that enforces access control at the database level. Policies are defined for each table that specify which rows can be accessed based on session variables.

### Session Variables

RLS policies check the `app.current_tenant_id` session variable:

```sql
SET LOCAL app.current_tenant_id = 'tenant-123';
```

### Policy Structure

Each tenant-scoped table has 4 policies:

1. **SELECT Policy**: Only show rows matching current tenant
2. **INSERT Policy**: Only allow inserting rows for current tenant
3. **UPDATE Policy**: Only allow updating rows for current tenant
4. **DELETE Policy**: Only allow deleting rows for current tenant

### Example Policy

```sql
CREATE POLICY "conversations_tenant_isolation_select"
  ON conversations
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );
```

### Benefits

- Cannot be bypassed by application code
- Protects raw SQL queries
- Works even if middleware is disabled
- Enforced at the PostgreSQL engine level

### Limitations

- Requires session variable to be set
- Slight performance overhead (minimal with indexes)
- More complex debugging

## Defense-in-Depth Strategy

### Why Two Layers?

1. **Redundancy**: If middleware has a bug, RLS catches it
2. **Raw SQL Protection**: RLS protects queries that bypass middleware
3. **Compliance**: Many security standards require database-level isolation
4. **Peace of Mind**: Multiple independent verification layers

### Attack Scenarios

#### Scenario 1: Middleware Bypassed

**Attack**: Developer uses global `prisma` client without middleware

```typescript
import { prisma } from '@ocsuite/db';

// ❌ Bypasses middleware - sees all tenants
await prisma.conversation.findMany();
```

**Defense**: This query still requires RLS context. Without it, returns no rows (RLS blocks access).

#### Scenario 2: SQL Injection

**Attack**: Malicious SQL injected into raw query

```typescript
const userId = "'; DROP TABLE conversations; --";
await db.$executeRaw`DELETE FROM users WHERE id = ${userId}`;
```

**Defense**:
1. Prisma parameterizes queries (prevents injection)
2. RLS limits damage to current tenant only
3. No cross-tenant data affected

#### Scenario 3: Context Manipulation

**Attack**: Attacker tries to change tenantId mid-request

```typescript
const db = createTenantClient({ tenantId: 'tenant-123', userId: 'user-456' });

// Try to access tenant-456
await db.conversation.findUnique({
  where: { id: 'conv-id', tenantId: 'tenant-456' }
});
```

**Defense**: Middleware overwrites the tenantId with the correct value from context. Query becomes:

```typescript
await db.conversation.findUnique({
  where: { id: 'conv-id', tenantId: 'tenant-123' } // Forced to correct tenant
});
```

#### Scenario 4: Direct Database Access

**Attack**: Someone gains direct PostgreSQL access

```sql
-- Try to see all conversations
SELECT * FROM conversations;
```

**Defense**: RLS requires session variable. Without it, query returns 0 rows.

#### Scenario 5: Privilege Escalation

**Attack**: Regular user tries to access admin data

```typescript
const db = createTenantClient({ tenantId: 'tenant-123', userId: 'regular-user' });

// Try to access admin conversations
await db.conversation.findMany();
```

**Defense**: Both middleware and RLS enforce tenant isolation, not role-based access. Role checks must be implemented at the application level separately.

**Note**: This package handles tenant isolation only. Implement role-based access control (RBAC) in your application layer.

## Security Checklist

### For Developers

- [ ] Always use `createTenantClient()` for tenant-scoped operations
- [ ] Never use global `prisma` client for tenant data
- [ ] Set RLS context for raw queries with `setRLSTenantContext()`
- [ ] Validate `tenantId` in API routes before creating client
- [ ] Never trust client-provided `tenantId` - get from server session
- [ ] Test cross-tenant access in unit tests
- [ ] Review database queries in production logs

### For DevOps

- [ ] Enable RLS on all tenant-scoped tables (done by migration)
- [ ] Verify RLS policies are active in production
- [ ] Monitor for queries without tenant context
- [ ] Use separate PostgreSQL users for app vs. admin access
- [ ] Restrict direct database access
- [ ] Regular security audits of RLS policies
- [ ] Test disaster recovery with tenant isolation intact

### For Security Auditors

- [ ] Verify middleware is applied to all Prisma clients
- [ ] Confirm RLS policies exist on all tenant-scoped tables
- [ ] Test that RLS blocks cross-tenant access
- [ ] Verify session variables are properly set
- [ ] Check that raw queries are protected
- [ ] Confirm indexes exist on all tenantId columns
- [ ] Review audit logs for suspicious patterns

## Testing Tenant Isolation

### Automated Tests

Run the test suite:

```bash
pnpm test
```

Tests cover:
- Middleware enforcement
- RLS policy enforcement
- Cross-tenant access prevention
- Raw SQL query protection
- Edge cases (KnowledgeEntry, etc.)

### Manual Testing

Use the provided SQL script:

```bash
psql $DATABASE_URL -f scripts/test-rls.sql
```

### Penetration Testing

Recommended tests:

1. **Cross-Tenant Read**: Try to access another tenant's data
2. **Cross-Tenant Write**: Try to create data for another tenant
3. **Context Manipulation**: Try to override tenantId in queries
4. **SQL Injection**: Attempt SQL injection with tenant bypass
5. **Raw Query Access**: Try raw queries without RLS context
6. **Bulk Operations**: Test updateMany/deleteMany don't leak data
7. **Relation Queries**: Test nested includes respect tenant boundaries

## Incident Response

### If Tenant Isolation is Breached

1. **Immediate Actions**:
   - Disable affected API endpoints
   - Rotate database credentials
   - Review recent query logs
   - Identify affected tenants

2. **Investigation**:
   - Check if middleware was bypassed
   - Verify RLS policies are active
   - Review application logs for anomalies
   - Identify root cause

3. **Remediation**:
   - Fix vulnerability
   - Deploy patch
   - Re-enable services
   - Notify affected tenants (if required by law)

4. **Post-Incident**:
   - Document lessons learned
   - Update security tests
   - Review all similar code paths
   - Consider additional security layers

## Compliance

This security architecture supports compliance with:

- **GDPR**: Data isolation per tenant/organization
- **HIPAA**: PHI isolation and access controls
- **SOC 2**: Logical access controls and data segregation
- **ISO 27001**: Access control and data protection

Consult with legal/compliance teams for specific requirements.

## Performance Considerations

### RLS Performance

- **Minimal Overhead**: RLS policies add ~1-5ms per query
- **Index Importance**: Ensure `tenantId` columns are indexed
- **Query Planning**: PostgreSQL query planner accounts for RLS

### Optimization Tips

1. **Use Connection Pooling**: Reduces connection overhead
2. **Cache Frequently Accessed Data**: Reduce database queries
3. **Monitor Slow Queries**: Use `EXPLAIN ANALYZE` with RLS
4. **Partition Large Tables**: Consider partitioning by tenantId

### Performance Testing

Test query performance with RLS:

```sql
EXPLAIN ANALYZE
SELECT * FROM conversations
WHERE "tenantId" = 'tenant-123';
```

Expected: Index scan on `conversations_tenantId_idx`

## Future Enhancements

Potential security improvements:

- [ ] Audit logging middleware (track all changes)
- [ ] Encryption at rest for sensitive fields
- [ ] Field-level encryption for PII
- [ ] Rate limiting per tenant
- [ ] Anomaly detection for unusual query patterns
- [ ] Read replicas with RLS for reporting
- [ ] Multi-region data residency

## References

- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Prisma Middleware](https://www.prisma.io/docs/concepts/components/prisma-client/middleware)
- [Multi-Tenant Architecture Patterns](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/overview)

## Contact

For security issues, contact: security@ocsuite.com (replace with actual contact)

**DO NOT** report security vulnerabilities in public issues.
