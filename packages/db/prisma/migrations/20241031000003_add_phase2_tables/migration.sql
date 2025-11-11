-- Phase 2 Migration: Module Insights & Analytics Snapshots
--
-- This migration adds new tables for Phase 2 features:
-- 1. ModuleInsight - Store insights from various dashboard modules
-- 2. AnalyticsSnapshot - Daily analytics data snapshots
-- 3. Updates Task model with moduleSlug and connectorId fields
--
-- Row Level Security (RLS) policies are included for tenant isolation

-- ============================================================================
-- CREATE NEW TABLES
-- ============================================================================

-- Module Insights Table
CREATE TABLE "module_insights" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "module_slug" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "highlights" TEXT[],
    "action_items" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "module_insights_pkey" PRIMARY KEY ("id")
);

-- Analytics Snapshots Table
CREATE TABLE "analytics_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connector_id" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source_breakdown" JSONB NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- UPDATE EXISTING TABLES
-- ============================================================================

-- Add new fields to tasks table
ALTER TABLE "tasks" ADD COLUMN "module_slug" TEXT;
ALTER TABLE "tasks" ADD COLUMN "connector_id" TEXT;

-- ============================================================================
-- CREATE INDEXES
-- ============================================================================

-- Module Insights Indexes
CREATE INDEX "module_insights_tenant_id_module_slug_idx" ON "module_insights"("tenant_id", "module_slug");
CREATE INDEX "module_insights_tenant_id_created_at_idx" ON "module_insights"("tenant_id", "created_at");
CREATE INDEX "module_insights_severity_idx" ON "module_insights"("severity");

-- Analytics Snapshots Indexes
CREATE UNIQUE INDEX "analytics_snapshots_tenant_id_date_key" ON "analytics_snapshots"("tenant_id", "date");
CREATE INDEX "analytics_snapshots_tenant_id_date_idx" ON "analytics_snapshots"("tenant_id", "date");
CREATE INDEX "analytics_snapshots_connector_id_idx" ON "analytics_snapshots"("connector_id");

-- Task Indexes for new fields
CREATE INDEX "tasks_module_slug_idx" ON "tasks"("module_slug");
CREATE INDEX "tasks_connector_id_idx" ON "tasks"("connector_id");

-- ============================================================================
-- ADD FOREIGN KEY CONSTRAINTS
-- ============================================================================

-- Module Insights foreign key
ALTER TABLE "module_insights" ADD CONSTRAINT "module_insights_tenant_id_fkey" 
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Analytics Snapshots foreign keys
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_tenant_id_fkey" 
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_connector_id_fkey" 
    FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE "module_insights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_snapshots" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- MODULE INSIGHTS RLS POLICIES
-- ============================================================================

CREATE POLICY "module_insights_tenant_isolation_select"
  ON "module_insights"
  FOR SELECT
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "module_insights_tenant_isolation_insert"
  ON "module_insights"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "module_insights_tenant_isolation_update"
  ON "module_insights"
  FOR UPDATE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "module_insights_tenant_isolation_delete"
  ON "module_insights"
  FOR DELETE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

-- ============================================================================
-- ANALYTICS SNAPSHOTS RLS POLICIES
-- ============================================================================

CREATE POLICY "analytics_snapshots_tenant_isolation_select"
  ON "analytics_snapshots"
  FOR SELECT
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "analytics_snapshots_tenant_isolation_insert"
  ON "analytics_snapshots"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "analytics_snapshots_tenant_isolation_update"
  ON "analytics_snapshots"
  FOR UPDATE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "analytics_snapshots_tenant_isolation_delete"
  ON "analytics_snapshots"
  FOR DELETE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

-- ============================================================================
-- POLICY DOCUMENTATION
-- ============================================================================

COMMENT ON POLICY "module_insights_tenant_isolation_select" ON "module_insights" IS
  'Enforces tenant isolation by only allowing access to module insights within the current tenant context';

COMMENT ON POLICY "analytics_snapshots_tenant_isolation_select" ON "analytics_snapshots" IS
  'Enforces tenant isolation by only allowing access to analytics snapshots within the current tenant context';

COMMENT ON TABLE "module_insights" IS
  'Stores insights generated by dashboard modules (e.g., growth-pulse, churn-watch). Each insight includes severity, summary, highlights, and actionable recommendations.';

COMMENT ON TABLE "analytics_snapshots" IS
  'Daily snapshots of analytics data including sessions, users, conversions, and revenue. One snapshot per tenant per day with optional link to the connector that sourced the data.';
