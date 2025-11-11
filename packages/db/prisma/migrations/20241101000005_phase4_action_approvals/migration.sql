-- Phase 4 Migration: Action Approvals & Notifications
--
-- Adds approval workflow tables, notification tracking, and links tasks to approvals.

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE "ActionApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'executing', 'executed', 'failed');
CREATE TYPE "NotificationChannel" AS ENUM ('in_app', 'email', 'slack_stub');

-- ============================================================================
-- TABLES
-- ============================================================================

CREATE TABLE "action_approvals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action_item_id" TEXT,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "status" "ActionApprovalStatus" NOT NULL DEFAULT 'pending',
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "audit_log" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'in_app',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- ALTER EXISTING TABLES
-- ============================================================================

ALTER TABLE "tasks"
  ADD COLUMN "action_approval_id" TEXT;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX "action_approvals_tenant_status_idx" ON "action_approvals" ("tenant_id", "status");
CREATE INDEX "action_approvals_created_by_idx" ON "action_approvals" ("created_by");
CREATE INDEX "action_approvals_approved_by_idx" ON "action_approvals" ("approved_by");
CREATE INDEX "notifications_tenant_user_idx" ON "notifications" ("tenant_id", "user_id");
CREATE INDEX "notifications_user_read_idx" ON "notifications" ("user_id", "read_at");
CREATE UNIQUE INDEX "tasks_action_approval_id_key" ON "tasks" ("action_approval_id");
CREATE INDEX "tasks_action_approval_id_idx" ON "tasks" ("action_approval_id");

-- ============================================================================
-- FOREIGN KEYS
-- ============================================================================

ALTER TABLE "action_approvals"
  ADD CONSTRAINT "action_approvals_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "action_approvals_action_item_id_fkey"
  FOREIGN KEY ("action_item_id") REFERENCES "board_action_items" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_action_approval_id_fkey"
  FOREIGN KEY ("action_approval_id") REFERENCES "action_approvals" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE "action_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "action_approvals_tenant_select"
  ON "action_approvals"
  FOR SELECT
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "action_approvals_tenant_insert"
  ON "action_approvals"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "action_approvals_tenant_update"
  ON "action_approvals"
  FOR UPDATE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "action_approvals_tenant_delete"
  ON "action_approvals"
  FOR DELETE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "notifications_tenant_select"
  ON "notifications"
  FOR SELECT
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "notifications_tenant_insert"
  ON "notifications"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "notifications_tenant_update"
  ON "notifications"
  FOR UPDATE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "notifications_tenant_delete"
  ON "notifications"
  FOR DELETE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE "action_approvals" IS 'Approval workflow entries tracking risk, status, and audit log for automated actions.';
COMMENT ON TABLE "notifications" IS 'Tenant-scoped notifications delivered to users (in-app/email/slack stub).';
