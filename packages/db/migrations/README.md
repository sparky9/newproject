# Database Migrations Guide

This directory contains database migration files for Online C Suite with VEA integration.

## Quick Start

Once you have your DATABASE_URL configured:

```bash
# Method 1: Using Prisma (Recommended)
cd packages/db
pnpm migrate:dev

# Method 2: Using SQL directly
psql $DATABASE_URL < migrations/add_persona_actions.sql
```

## Available Migrations

### `add_persona_actions.sql`

Creates the `persona_actions` table for VEA integration.

**What it creates:**
- `PersonaActionStatus` enum type
- `persona_actions` table
- Indexes for query performance
- Triggers for auto-updating `updated_at`
- Foreign key constraints

**Required:** Yes (for VEA functionality)

**When to run:** After initial database setup, before enabling VEA

## Migration Methods

### Method 1: Prisma Migrate (Recommended)

Prisma manages migrations automatically:

```bash
cd packages/db

# Development: Create and apply migration
pnpm migrate:dev

# Production: Apply pending migrations
pnpm migrate:deploy

# Check migration status
pnpm migrate:status

# Reset database (WARNING: deletes all data)
pnpm migrate:reset
```

**Advantages:**
- Automatic tracking
- Rollback support
- Version control
- Schema validation

### Method 2: Manual SQL

Run SQL files directly:

```bash
# Connect to database
psql $DATABASE_URL

# Run migration
\i packages/db/migrations/add_persona_actions.sql

# Verify
\dt persona_actions
\d persona_actions
```

**When to use:**
- Custom database setup
- Migration troubleshooting
- Schema inspection
- Production hotfixes

## Migration Workflow

### Development

1. **Update Prisma Schema**
   ```prisma
   // packages/db/prisma/schema.prisma
   model NewFeature {
     // ... fields
   }
   ```

2. **Generate Migration**
   ```bash
   cd packages/db
   pnpm migrate:dev --name add_new_feature
   ```

3. **Review Generated SQL**
   ```bash
   # Check migrations directory
   ls -la prisma/migrations/
   ```

4. **Test Migration**
   ```bash
   # Apply to test database
   DATABASE_URL="postgresql://..." pnpm migrate:deploy
   ```

### Production

1. **Review Migration Files**
   - Check generated SQL
   - Validate changes
   - Test on staging

2. **Backup Database**
   ```bash
   pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
   ```

3. **Run Migration**
   ```bash
   pnpm migrate:deploy
   ```

4. **Verify**
   ```bash
   pnpm migrate:status
   ```

## Troubleshooting

### Migration Fails

**Error:** `Migration failed to apply`

**Solutions:**
1. Check database connection:
   ```bash
   psql $DATABASE_URL -c "SELECT version();"
   ```

2. Check migration status:
   ```bash
   pnpm migrate:status
   ```

3. Manually resolve:
   ```bash
   # Mark migration as applied
   pnpm migrate:resolve --applied <migration_name>

   # Mark migration as rolled back
   pnpm migrate:resolve --rolled-back <migration_name>
   ```

### Table Already Exists

**Error:** `relation "persona_actions" already exists`

**Solutions:**
1. Check if migration already applied:
   ```sql
   SELECT * FROM _prisma_migrations ORDER BY finished_at DESC;
   ```

2. Mark as applied if safe:
   ```bash
   pnpm migrate:resolve --applied add_persona_actions
   ```

### Schema Drift

**Error:** `Database schema is not in sync`

**Solutions:**
1. Check diff:
   ```bash
   pnpm migrate:diff
   ```

2. Reset (development only):
   ```bash
   pnpm migrate:reset
   ```

3. Generate new migration:
   ```bash
   pnpm migrate:dev
   ```

## Best Practices

### Before Migration

- [ ] Backup production database
- [ ] Test on staging environment
- [ ] Review generated SQL
- [ ] Check for breaking changes
- [ ] Plan rollback strategy

### During Migration

- [ ] Use transaction if possible
- [ ] Monitor for locks
- [ ] Watch execution time
- [ ] Check for errors

### After Migration

- [ ] Verify schema changes
- [ ] Test application
- [ ] Check performance
- [ ] Update documentation

## Common Commands

```bash
# Create new migration
pnpm migrate:dev --name <name>

# Apply migrations
pnpm migrate:deploy

# Check status
pnpm migrate:status

# Reset database (dev only)
pnpm migrate:reset

# Generate Prisma client
pnpm generate

# Open Prisma Studio
pnpm studio

# Format schema
pnpm format

# Validate schema
pnpm validate
```

## Migration Files

Prisma stores migrations in:
```
packages/db/prisma/migrations/
├── 20250111000000_init/
│   └── migration.sql
├── 20250111000001_add_persona_actions/
│   └── migration.sql
└── migration_lock.toml
```

## Rollback Procedure

If a migration causes issues:

1. **Restore from Backup**
   ```bash
   psql $DATABASE_URL < backup.sql
   ```

2. **Mark Migration as Rolled Back**
   ```bash
   pnpm migrate:resolve --rolled-back <migration_name>
   ```

3. **Fix Migration**
   - Edit migration file
   - Or create new migration to fix

4. **Reapply**
   ```bash
   pnpm migrate:deploy
   ```

## Schema Validation

Verify schema matches database:

```bash
# Check for drift
pnpm migrate:status

# Validate schema syntax
pnpm validate

# Generate introspection
pnpm db:pull
```

## Performance Tips

- Create indexes for frequently queried columns
- Use partial indexes where appropriate
- Add constraints for data integrity
- Use JSONB for flexible schemas
- Monitor query performance with EXPLAIN

## Support

- **Prisma Docs:** https://www.prisma.io/docs/concepts/components/prisma-migrate
- **PostgreSQL Docs:** https://www.postgresql.org/docs/
- **Setup Guide:** [SETUP.md](../../../SETUP.md)
- **Deployment Guide:** [DEPLOYMENT.md](../../../DEPLOYMENT.md)
