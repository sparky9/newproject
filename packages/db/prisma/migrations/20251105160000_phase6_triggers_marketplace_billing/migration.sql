-- Phase 6: Proactive triggers, alerting, marketplace widgets, and billing instrumentation
-- Introduces trigger rules, alert records, widget registry, tenant widget installs,
-- billing usage aggregates, and enriches usage snapshots with summary metrics.

BEGIN;

-- Enum types for trigger engine and alerting
DO $$
BEGIN
  CREATE TYPE "TriggerRuleType" AS ENUM ('schedule', 'metric_threshold', 'anomaly');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE "TriggerSeverity" AS ENUM ('info', 'warning', 'critical');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE "AlertStatus" AS ENUM ('pending', 'acknowledged', 'resolved', 'snoozed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- Trigger rules configured per tenant
CREATE TABLE IF NOT EXISTS trigger_rules (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "TriggerRuleType" NOT NULL,
  "schedule_cron" TEXT,
  "metric_key" TEXT,
  "threshold_value" DOUBLE PRECISION,
  "window_days" INTEGER,
  "config_json" JSONB,
  "severity" "TriggerSeverity" NOT NULL DEFAULT 'warning',
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "last_run_at" TIMESTAMP,
  "last_triggered_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE trigger_rules
  ADD CONSTRAINT trigger_rules_tenant_fkey
  FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS trigger_rules_tenant_enabled_idx
  ON trigger_rules ("tenant_id", "enabled");

-- Alerts generated from triggers or other systems
CREATE TABLE IF NOT EXISTS alerts (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "rule_id" TEXT,
  "type" "TriggerRuleType",
  "severity" "TriggerSeverity" NOT NULL DEFAULT 'warning',
  "title" TEXT,
  "summary" TEXT,
  "payload" JSONB,
  "status" "AlertStatus" NOT NULL DEFAULT 'pending',
  "acknowledged_at" TIMESTAMP,
  "acknowledged_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE alerts
  ADD CONSTRAINT alerts_tenant_fkey
  FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE alerts
  ADD CONSTRAINT alerts_rule_fkey
  FOREIGN KEY ("rule_id") REFERENCES trigger_rules("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS alerts_tenant_status_idx
  ON alerts ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS alerts_rule_id_idx
  ON alerts ("rule_id");

-- Marketplace widget registry (global)
CREATE TABLE IF NOT EXISTS widgets (
  "slug" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "required_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "config" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Tenant widget installations and configuration
CREATE TABLE IF NOT EXISTS tenant_widgets (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "widget_slug" TEXT NOT NULL,
  "enabled_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "settings_json" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_widgets
  ADD CONSTRAINT tenant_widgets_tenant_fkey
  FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE tenant_widgets
  ADD CONSTRAINT tenant_widgets_widget_fkey
  FOREIGN KEY ("widget_slug") REFERENCES widgets("slug")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_widgets_unique_install_idx
  ON tenant_widgets ("tenant_id", "widget_slug");

CREATE INDEX IF NOT EXISTS tenant_widgets_widget_idx
  ON tenant_widgets ("widget_slug");

-- Daily billing usage aggregates per tenant
CREATE TABLE IF NOT EXISTS billing_usage (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "tokens_used" INTEGER NOT NULL DEFAULT 0,
  "tasks_executed" INTEGER NOT NULL DEFAULT 0,
  "alerts_triggered" INTEGER NOT NULL DEFAULT 0,
  "active_widgets" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE billing_usage
  ADD CONSTRAINT billing_usage_tenant_fkey
  FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS billing_usage_date_unique_idx
  ON billing_usage ("tenant_id", "date");

CREATE INDEX IF NOT EXISTS billing_usage_tenant_idx
  ON billing_usage ("tenant_id");

-- Enrich usage snapshots with alert and widget metrics plus summary JSON
ALTER TABLE usage_snapshots
  ADD COLUMN IF NOT EXISTS "alerts_triggered" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "active_widgets" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "summary_metrics" JSONB;

-- Link notifications to alerts (optional)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS "alert_id" TEXT;

CREATE INDEX IF NOT EXISTS notifications_alert_id_idx
  ON notifications ("alert_id");

ALTER TABLE notifications
  ADD CONSTRAINT notifications_alert_fkey
  FOREIGN KEY ("alert_id") REFERENCES alerts("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security policies for tenant-scoped tables
ALTER TABLE trigger_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "trigger_rules_tenant_select"
    ON trigger_rules
    FOR SELECT
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "trigger_rules_tenant_write"
    ON trigger_rules
    FOR ALL
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
    WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "alerts_tenant_select"
    ON alerts
    FOR SELECT
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "alerts_tenant_write"
    ON alerts
    FOR ALL
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
    WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "tenant_widgets_tenant_select"
    ON tenant_widgets
    FOR SELECT
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "tenant_widgets_tenant_write"
    ON tenant_widgets
    FOR ALL
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
    WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "billing_usage_tenant_select"
    ON billing_usage
    FOR SELECT
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "billing_usage_tenant_write"
    ON billing_usage
    FOR ALL
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
    WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

COMMIT;
