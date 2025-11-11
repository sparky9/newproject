-- Manual RLS Testing Script
--
-- This script allows you to manually test Row-Level Security policies
-- Run this in your PostgreSQL client (psql, pgAdmin, etc.)
--
-- Usage:
--   1. Replace 'tenant-id-here' with actual tenant IDs from your database
--   2. Run each section separately and observe the results
--   3. Verify that cross-tenant access is blocked

-- ============================================================================
-- SETUP: Create test data
-- ============================================================================

-- Create test tenants
INSERT INTO tenants (id, name, slug, "createdAt", "updatedAt")
VALUES
  ('rls-test-tenant-1', 'RLS Test Tenant 1', 'rls-test-1', NOW(), NOW()),
  ('rls-test-tenant-2', 'RLS Test Tenant 2', 'rls-test-2', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create test users
INSERT INTO users (id, "clerkId", email, name, "createdAt", "updatedAt")
VALUES
  ('rls-test-user-1', 'clerk-rls-1', 'rlstest1@test.com', 'RLS Test User 1', NOW(), NOW()),
  ('rls-test-user-2', 'clerk-rls-2', 'rlstest2@test.com', 'RLS Test User 2', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create test conversations
INSERT INTO conversations (id, "tenantId", "userId", "personaType", title, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'rls-test-tenant-1', 'rls-test-user-1', 'ceo', 'RLS Test Conv 1', NOW(), NOW()),
  (gen_random_uuid(), 'rls-test-tenant-2', 'rls-test-user-2', 'cfo', 'RLS Test Conv 2', NOW(), NOW());

-- ============================================================================
-- TEST 1: SELECT with tenant context
-- ============================================================================

-- Set context to tenant 1
SET LOCAL app.current_tenant_id = 'rls-test-tenant-1';

-- This should ONLY return tenant 1's conversations
SELECT id, "tenantId", title FROM conversations;

-- Expected: 1 row with tenantId = 'rls-test-tenant-1'

-- ============================================================================
-- TEST 2: SELECT with different tenant context
-- ============================================================================

-- Switch to tenant 2
SET LOCAL app.current_tenant_id = 'rls-test-tenant-2';

-- This should ONLY return tenant 2's conversations
SELECT id, "tenantId", title FROM conversations;

-- Expected: 1 row with tenantId = 'rls-test-tenant-2'

-- ============================================================================
-- TEST 3: INSERT with tenant context
-- ============================================================================

-- Set context to tenant 1
SET LOCAL app.current_tenant_id = 'rls-test-tenant-1';

-- This should succeed
INSERT INTO conversations (id, "tenantId", "userId", "personaType", title, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'rls-test-tenant-1', 'rls-test-user-1', 'cmo', 'Valid Insert', NOW(), NOW());

-- Expected: Success

-- ============================================================================
-- TEST 4: INSERT with mismatched tenant (should FAIL)
-- ============================================================================

-- Context is tenant 1, but trying to insert tenant 2 data
SET LOCAL app.current_tenant_id = 'rls-test-tenant-1';

-- This should FAIL with policy violation
INSERT INTO conversations (id, "tenantId", "userId", "personaType", title, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'rls-test-tenant-2', 'rls-test-user-2', 'cto', 'Malicious Insert', NOW(), NOW());

-- Expected: ERROR - new row violates row-level security policy

-- ============================================================================
-- TEST 5: UPDATE with tenant context
-- ============================================================================

-- Get a conversation ID from tenant 1
SET LOCAL app.current_tenant_id = 'rls-test-tenant-1';
SELECT id FROM conversations WHERE "tenantId" = 'rls-test-tenant-1' LIMIT 1;
-- Copy the ID from above

-- Update with matching context (should succeed)
UPDATE conversations
SET title = 'Updated Title'
WHERE id = '<paste-id-here>';

-- Expected: Success

-- ============================================================================
-- TEST 6: UPDATE with wrong tenant context (should FAIL)
-- ============================================================================

-- Get a conversation ID from tenant 1
SELECT id FROM conversations WHERE "tenantId" = 'rls-test-tenant-1' LIMIT 1;
-- Copy the ID

-- Try to update as tenant 2 (should fail)
SET LOCAL app.current_tenant_id = 'rls-test-tenant-2';
UPDATE conversations
SET title = 'Malicious Update'
WHERE id = '<paste-id-here>';

-- Expected: 0 rows affected (RLS blocks access)

-- ============================================================================
-- TEST 7: DELETE with tenant context
-- ============================================================================

-- Create a conversation to delete
SET LOCAL app.current_tenant_id = 'rls-test-tenant-1';
INSERT INTO conversations (id, "tenantId", "userId", "personaType", title, "createdAt", "updatedAt")
VALUES ('to-delete-1', 'rls-test-tenant-1', 'rls-test-user-1', 'ceo', 'To Delete', NOW(), NOW());

-- Delete with matching context (should succeed)
DELETE FROM conversations WHERE id = 'to-delete-1';

-- Expected: 1 row deleted

-- ============================================================================
-- TEST 8: DELETE with wrong tenant context (should FAIL)
-- ============================================================================

-- Create a conversation in tenant 1
SET LOCAL app.current_tenant_id = 'rls-test-tenant-1';
INSERT INTO conversations (id, "tenantId", "userId", "personaType", title, "createdAt", "updatedAt")
VALUES ('to-delete-2', 'rls-test-tenant-1', 'rls-test-user-1', 'ceo', 'Protected', NOW(), NOW());

-- Try to delete as tenant 2 (should fail)
SET LOCAL app.current_tenant_id = 'rls-test-tenant-2';
DELETE FROM conversations WHERE id = 'to-delete-2';

-- Expected: 0 rows deleted (RLS blocks access)

-- Verify the row still exists
SET LOCAL app.current_tenant_id = 'rls-test-tenant-1';
SELECT id, title FROM conversations WHERE id = 'to-delete-2';

-- Expected: 1 row (still exists)

-- ============================================================================
-- TEST 9: Knowledge entries (company-wide and tenant-specific)
-- ============================================================================

-- Create tenant-specific knowledge
SET LOCAL app.current_tenant_id = 'rls-test-tenant-1';
INSERT INTO knowledge_entries (id, "tenantId", source, content, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'rls-test-tenant-1', 'tenant-docs', 'Tenant 1 knowledge', NOW(), NOW());

-- Create company-wide knowledge
INSERT INTO knowledge_entries (id, "tenantId", source, content, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), NULL, 'company-docs', 'Company-wide knowledge', NOW(), NOW());

-- Query as tenant 1 (should see both tenant-specific and company-wide)
SELECT "tenantId", source, content FROM knowledge_entries;

-- Expected: 2 rows (tenant 1's entry + company-wide entry)

-- Query as tenant 2 (should only see company-wide)
SET LOCAL app.current_tenant_id = 'rls-test-tenant-2';
SELECT "tenantId", source, content FROM knowledge_entries;

-- Expected: 1 row (only company-wide entry)

-- ============================================================================
-- CLEANUP: Remove test data
-- ============================================================================

-- Clear RLS context
SET LOCAL app.current_tenant_id = NULL;

-- Delete test data
DELETE FROM conversations WHERE "tenantId" IN ('rls-test-tenant-1', 'rls-test-tenant-2');
DELETE FROM knowledge_entries WHERE "tenantId" IN ('rls-test-tenant-1', 'rls-test-tenant-2') OR source IN ('tenant-docs', 'company-docs');
DELETE FROM users WHERE id IN ('rls-test-user-1', 'rls-test-user-2');
DELETE FROM tenants WHERE id IN ('rls-test-tenant-1', 'rls-test-tenant-2');

-- ============================================================================
-- VERIFICATION: Check RLS is enabled
-- ============================================================================

-- Verify RLS is enabled on all tenant-scoped tables
SELECT
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'tenant_members',
    'conversations',
    'messages',
    'connectors',
    'tasks',
    'usage_snapshots',
    'knowledge_entries',
    'business_profiles'
  )
ORDER BY tablename;

-- Expected: All tables should have rls_enabled = true

-- ============================================================================
-- VERIFICATION: List all RLS policies
-- ============================================================================

SELECT
  tablename,
  policyname,
  cmd as operation,
  qual as using_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Expected: 4 policies per table (SELECT, INSERT, UPDATE, DELETE)
