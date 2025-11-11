-- Row Level Security (RLS) Policies for Tenant Isolation
--
-- This migration enables Row Level Security on all tenant-scoped tables
-- and creates policies to enforce tenant isolation at the database level.
--
-- CRITICAL SECURITY LAYER: These policies provide defense-in-depth protection
-- against tenant data leakage even if application middleware is bypassed.
--
-- Testing Requirements:
-- 1. Test policies with different tenant contexts set via session variables
-- 2. Verify cross-tenant access is blocked at database level
-- 3. Test all CRUD operations with RLS enabled
-- 4. Use: SET LOCAL app.current_tenant_id = 'tenant-id-here';

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TENANT MEMBERS POLICIES
-- ============================================================================

CREATE POLICY "tenant_members_tenant_isolation_select"
  ON tenant_members
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "tenant_members_tenant_isolation_insert"
  ON tenant_members
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "tenant_members_tenant_isolation_update"
  ON tenant_members
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "tenant_members_tenant_isolation_delete"
  ON tenant_members
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

-- ============================================================================
-- CONVERSATIONS POLICIES
-- ============================================================================

CREATE POLICY "conversations_tenant_isolation_select"
  ON conversations
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "conversations_tenant_isolation_insert"
  ON conversations
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "conversations_tenant_isolation_update"
  ON conversations
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "conversations_tenant_isolation_delete"
  ON conversations
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

-- ============================================================================
-- MESSAGES POLICIES
-- ============================================================================

CREATE POLICY "messages_tenant_isolation_select"
  ON messages
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "messages_tenant_isolation_insert"
  ON messages
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "messages_tenant_isolation_update"
  ON messages
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "messages_tenant_isolation_delete"
  ON messages
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

-- ============================================================================
-- CONNECTORS POLICIES
-- ============================================================================

CREATE POLICY "connectors_tenant_isolation_select"
  ON connectors
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "connectors_tenant_isolation_insert"
  ON connectors
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "connectors_tenant_isolation_update"
  ON connectors
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "connectors_tenant_isolation_delete"
  ON connectors
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

-- ============================================================================
-- TASKS POLICIES
-- ============================================================================

CREATE POLICY "tasks_tenant_isolation_select"
  ON tasks
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "tasks_tenant_isolation_insert"
  ON tasks
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "tasks_tenant_isolation_update"
  ON tasks
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "tasks_tenant_isolation_delete"
  ON tasks
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

-- ============================================================================
-- USAGE SNAPSHOTS POLICIES
-- ============================================================================

CREATE POLICY "usage_snapshots_tenant_isolation_select"
  ON usage_snapshots
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "usage_snapshots_tenant_isolation_insert"
  ON usage_snapshots
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "usage_snapshots_tenant_isolation_update"
  ON usage_snapshots
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "usage_snapshots_tenant_isolation_delete"
  ON usage_snapshots
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

-- ============================================================================
-- KNOWLEDGE ENTRIES POLICIES
-- ============================================================================

-- Knowledge entries can be either tenant-specific or company-wide (tenantId = null)
-- These policies allow access to:
-- 1. Tenant-specific entries matching the current tenant
-- 2. Company-wide entries (tenantId IS NULL)

CREATE POLICY "knowledge_entries_tenant_isolation_select"
  ON knowledge_entries
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR "tenantId" IS NULL
  );

CREATE POLICY "knowledge_entries_tenant_isolation_insert"
  ON knowledge_entries
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR "tenantId" IS NULL
  );

CREATE POLICY "knowledge_entries_tenant_isolation_update"
  ON knowledge_entries
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR "tenantId" IS NULL
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR "tenantId" IS NULL
  );

CREATE POLICY "knowledge_entries_tenant_isolation_delete"
  ON knowledge_entries
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR "tenantId" IS NULL
  );

-- ============================================================================
-- BUSINESS PROFILES POLICIES
-- ============================================================================

CREATE POLICY "business_profiles_tenant_isolation_select"
  ON business_profiles
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "business_profiles_tenant_isolation_insert"
  ON business_profiles
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "business_profiles_tenant_isolation_update"
  ON business_profiles
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

CREATE POLICY "business_profiles_tenant_isolation_delete"
  ON business_profiles
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
  );

-- ============================================================================
-- POLICY DOCUMENTATION
-- ============================================================================

COMMENT ON POLICY "tenant_members_tenant_isolation_select" ON tenant_members IS
  'Enforces tenant isolation by only allowing access to tenant members within the current tenant context';

COMMENT ON POLICY "conversations_tenant_isolation_select" ON conversations IS
  'Enforces tenant isolation by only allowing access to conversations within the current tenant context';

COMMENT ON POLICY "messages_tenant_isolation_select" ON messages IS
  'Enforces tenant isolation by only allowing access to messages within the current tenant context';

COMMENT ON POLICY "connectors_tenant_isolation_select" ON connectors IS
  'Enforces tenant isolation by only allowing access to connectors within the current tenant context';

COMMENT ON POLICY "tasks_tenant_isolation_select" ON tasks IS
  'Enforces tenant isolation by only allowing access to tasks within the current tenant context';

COMMENT ON POLICY "usage_snapshots_tenant_isolation_select" ON usage_snapshots IS
  'Enforces tenant isolation by only allowing access to usage snapshots within the current tenant context';

COMMENT ON POLICY "knowledge_entries_tenant_isolation_select" ON knowledge_entries IS
  'Allows access to tenant-specific knowledge entries and company-wide entries (tenantId IS NULL)';

COMMENT ON POLICY "business_profiles_tenant_isolation_select" ON business_profiles IS
  'Enforces tenant isolation by only allowing access to business profiles within the current tenant context';
