# Deployment Checklist

This document provides a comprehensive checklist for deploying @ocsuite/db to production.

## Pre-Deployment Checklist

### 1. Environment Setup

- [ ] PostgreSQL 14+ installed and running
- [ ] pgvector extension installed
- [ ] Database user created with appropriate permissions
- [ ] Production database created
- [ ] Connection pooler configured (PgBouncer recommended)
- [ ] SSL/TLS enabled for database connections

### 2. Environment Variables

- [ ] `DATABASE_URL` configured with production credentials
- [ ] Connection string uses SSL: `?sslmode=require`
- [ ] Connection string uses connection pooler if available
- [ ] `NODE_ENV=production` set
- [ ] Secrets stored securely (AWS Secrets Manager, etc.)

### 3. Security Verification

- [ ] All migrations reviewed and tested on staging
- [ ] RLS policies verified on staging database
- [ ] Tenant isolation tested (run `pnpm test`)
- [ ] SQL script tested (`scripts/test-rls.sql`)
- [ ] No hardcoded credentials in code
- [ ] Database user has minimal required permissions

### 4. Performance Optimization

- [ ] Connection pool sized appropriately
- [ ] All indexes created (automatic with migrations)
- [ ] Query logging configured for production
- [ ] Slow query monitoring enabled
- [ ] Database metrics/monitoring configured

### 5. Testing

- [ ] All unit tests passing (`pnpm test`)
- [ ] Integration tests passing
- [ ] Load testing completed
- [ ] Tenant isolation verified manually
- [ ] RLS policies tested in staging

## Deployment Steps

### Step 1: Backup

```bash
# Backup current database (if upgrading)
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Store backup securely
aws s3 cp backup_*.sql s3://your-backup-bucket/
```

### Step 2: Install Dependencies

```bash
cd packages/db
pnpm install --frozen-lockfile
```

### Step 3: Run Migrations

```bash
# Generate Prisma client
pnpm generate

# Run migrations (production)
pnpm migrate

# Verify migrations applied
psql $DATABASE_URL -c "\dt"
```

### Step 4: Verify RLS

```bash
# Check RLS is enabled
psql $DATABASE_URL -c "
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
"

# Verify policies exist
psql $DATABASE_URL -c "
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
"
```

### Step 5: Build Package

```bash
# Build TypeScript
pnpm build

# Verify build output
ls -lh dist/
```

### Step 6: Smoke Tests

```bash
# Run health check
node -e "
const { checkDatabaseHealth } = require('./dist/index.js');
checkDatabaseHealth().then(healthy => {
  console.log('Database health:', healthy ? 'OK' : 'FAILED');
  process.exit(healthy ? 0 : 1);
});
"
```

### Step 7: Deploy Application

Deploy your application with the updated database package.

### Step 8: Monitor

- [ ] Check application logs for database errors
- [ ] Monitor query performance
- [ ] Verify tenant isolation working
- [ ] Check connection pool usage
- [ ] Monitor database CPU/memory

## Post-Deployment Verification

### Verify Tenant Isolation

```typescript
// Test script to run after deployment
import { createTenantClient, prisma } from '@ocsuite/db';

async function verifyIsolation() {
  // Create test tenants
  const tenant1 = await prisma.tenant.create({
    data: { name: 'Test 1', slug: 'test-1' },
  });
  const tenant2 = await prisma.tenant.create({
    data: { name: 'Test 2', slug: 'test-2' },
  });

  const user1 = await prisma.user.create({
    data: { clerkId: 'test-1', email: 'test1@test.com' },
  });

  // Create data for tenant 1
  const db1 = createTenantClient({
    tenantId: tenant1.id,
    userId: user1.id,
  });
  await db1.conversation.create({
    data: {
      userId: user1.id,
      personaType: 'ceo',
      title: 'Test',
    },
  });

  // Query as tenant 2 (should see nothing)
  const db2 = createTenantClient({
    tenantId: tenant2.id,
    userId: user1.id,
  });
  const conversations = await db2.conversation.findMany();

  console.assert(
    conversations.length === 0,
    'Tenant isolation FAILED: Tenant 2 can see Tenant 1 data!'
  );

  console.log('✅ Tenant isolation verified');

  // Cleanup
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany({ where: { email: 'test1@test.com' } });
  await prisma.tenant.deleteMany({
    where: { slug: { in: ['test-1', 'test-2'] } },
  });
}

verifyIsolation().catch(console.error);
```

## Rollback Procedure

If deployment fails:

### Step 1: Restore Database

```bash
# Stop application
kubectl scale deployment api --replicas=0

# Restore backup
psql $DATABASE_URL < backup_YYYYMMDD_HHMMSS.sql

# Verify restoration
psql $DATABASE_URL -c "SELECT COUNT(*) FROM tenants;"
```

### Step 2: Revert Code

```bash
# Revert to previous version
git checkout previous-working-tag
pnpm install
pnpm build

# Redeploy
./deploy.sh
```

### Step 3: Verify

- [ ] Application running
- [ ] Database accessible
- [ ] Data intact
- [ ] No errors in logs

## Monitoring Setup

### Database Metrics

Monitor these metrics:

1. **Connection Pool**:
   - Active connections
   - Waiting connections
   - Connection errors

2. **Query Performance**:
   - Slow queries (> 100ms)
   - Query errors
   - Queries per second

3. **Storage**:
   - Database size
   - Table sizes
   - Index sizes

4. **Security**:
   - Failed RLS checks
   - Context errors
   - Unusual query patterns

### Alerting Rules

Set up alerts for:

- Database connection failures
- Slow queries > 1 second
- RLS policy violations
- Context errors > 10/minute
- Connection pool exhaustion
- Disk space < 20%

### Logging

Configure structured logging:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('query', (e) => {
  if (e.duration > 100) {
    logger.warn('Slow query detected', {
      query: e.query,
      duration: e.duration,
      params: e.params,
    });
  }
});

prisma.$on('error', (e) => {
  logger.error('Database error', {
    message: e.message,
    target: e.target,
  });
});
```

## Scaling Considerations

### Vertical Scaling

Increase database resources:
- CPU: 2-4 cores minimum
- RAM: 8-16GB minimum
- Storage: SSD with 1000+ IOPS

### Horizontal Scaling

For read-heavy workloads:

1. **Read Replicas**:
   - Set up PostgreSQL replication
   - Route read queries to replicas
   - Maintain RLS on replicas

2. **Connection Pooling**:
   - Use PgBouncer or pgpool
   - Configure pool size: `(2 * cores) + spindles`
   - Use transaction pooling for best performance

3. **Caching**:
   - Cache frequently accessed data in Redis
   - Invalidate cache on updates
   - Cache per tenant to maintain isolation

### Multi-Region

For global deployments:

1. **Primary Region**:
   - Master database
   - Write operations

2. **Secondary Regions**:
   - Read replicas
   - Read-only operations
   - Cross-region replication

3. **Data Residency**:
   - Partition data by region if required
   - Route queries to regional database
   - Maintain tenant isolation per region

## Maintenance

### Regular Tasks

**Daily**:
- [ ] Check error logs
- [ ] Monitor slow queries
- [ ] Verify backups completed

**Weekly**:
- [ ] Review query performance
- [ ] Check connection pool usage
- [ ] Analyze table sizes

**Monthly**:
- [ ] Run `VACUUM ANALYZE`
- [ ] Review indexes
- [ ] Update statistics
- [ ] Test disaster recovery

### Database Maintenance

```sql
-- Vacuum and analyze (run during low traffic)
VACUUM ANALYZE;

-- Check table bloat
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan ASC;

-- Reindex if needed
REINDEX DATABASE your_database;
```

## Disaster Recovery

### Backup Strategy

1. **Automated Backups**:
   - Daily full backups
   - Hourly incremental backups
   - Retention: 30 days
   - Store in S3 or equivalent

2. **Point-in-Time Recovery**:
   - Enable WAL archiving
   - Configure continuous archiving
   - Test recovery quarterly

### Recovery Testing

Test recovery procedure quarterly:

```bash
# 1. Create test database
createdb recovery_test

# 2. Restore from backup
pg_restore -d recovery_test backup.sql

# 3. Verify data integrity
psql recovery_test -c "SELECT COUNT(*) FROM tenants;"

# 4. Verify RLS policies
psql recovery_test -f scripts/test-rls.sql

# 5. Drop test database
dropdb recovery_test
```

## Security Hardening

### Production Security

- [ ] Database user has minimal permissions
- [ ] SSL/TLS required for connections
- [ ] Firewall rules restrict database access
- [ ] Audit logging enabled
- [ ] Regular security patches applied
- [ ] Rotate credentials quarterly
- [ ] Review access logs monthly

### PostgreSQL Security

```sql
-- Revoke public schema privileges
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Grant only required permissions
GRANT CONNECT ON DATABASE your_db TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Enable audit logging
ALTER SYSTEM SET log_statement = 'ddl';
ALTER SYSTEM SET log_connections = 'on';
ALTER SYSTEM SET log_disconnections = 'on';
```

## Troubleshooting

### Common Issues

**Issue**: Connection pool exhausted
**Solution**: Increase pool size or reduce connection leaks

**Issue**: Slow queries
**Solution**: Add indexes, optimize queries, or increase resources

**Issue**: RLS not enforcing
**Solution**: Verify policies enabled, check session variables

**Issue**: Migrations failing
**Solution**: Check database permissions, review migration SQL

### Debug Mode

Enable debug logging:

```typescript
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});
```

## Success Criteria

Deployment is successful when:

- [ ] All migrations applied successfully
- [ ] RLS policies active and verified
- [ ] Application connects to database
- [ ] Tenant isolation working correctly
- [ ] No errors in application logs
- [ ] Query performance acceptable (< 100ms p95)
- [ ] Monitoring and alerts configured
- [ ] Backups running successfully

## Support

For issues during deployment:

1. Check logs: `kubectl logs -f deployment/api`
2. Check database: `psql $DATABASE_URL`
3. Review this checklist
4. Contact DevOps team
5. Escalate to database admin if needed

## Post-Deployment

After successful deployment:

- [ ] Update runbook with any issues encountered
- [ ] Document any configuration changes
- [ ] Schedule next deployment review
- [ ] Update team on deployment status
- [ ] Monitor for 24 hours

---

**Note**: Always test deployments on staging before production!
