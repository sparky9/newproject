-- Phase 5: Knowledge audit log for ingestion lifecycle
-- Records upload/delete/export events per knowledge source with RLS protection.

BEGIN;

-- Enum for audit event types
CREATE TYPE "KnowledgeAuditEventType" AS ENUM ('upload', 'delete', 'export');

-- Audit log table capturing knowledge lifecycle events
CREATE TABLE IF NOT EXISTS knowledge_audit_events (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NULL,
  "source_id" TEXT NULL,
  "source_name" TEXT NOT NULL,
  "event" "KnowledgeAuditEventType" NOT NULL,
  "actor_id" TEXT NULL,
  "summary" TEXT NOT NULL,
  "entry_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Foreign key relationships
ALTER TABLE knowledge_audit_events
  ADD CONSTRAINT knowledge_audit_events_tenant_fkey
  FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE knowledge_audit_events
  ADD CONSTRAINT knowledge_audit_events_source_fkey
  FOREIGN KEY ("source_id") REFERENCES knowledge_sources("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS knowledge_audit_events_tenant_created_idx
  ON knowledge_audit_events ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS knowledge_audit_events_source_idx
  ON knowledge_audit_events ("source_id");

-- Row Level Security mirrors knowledge sources/entries policies
ALTER TABLE knowledge_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "knowledge_audit_events_tenant_select"
    ON knowledge_audit_events
    FOR SELECT
    USING (
      "tenant_id" = current_setting('app.current_tenant_id', true)::text
      OR "tenant_id" IS NULL
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "knowledge_audit_events_tenant_insert"
    ON knowledge_audit_events
    FOR INSERT
    WITH CHECK (
      "tenant_id" = current_setting('app.current_tenant_id', true)::text
      OR "tenant_id" IS NULL
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "knowledge_audit_events_tenant_delete"
    ON knowledge_audit_events
    FOR DELETE
    USING (
      "tenant_id" = current_setting('app.current_tenant_id', true)::text
      OR "tenant_id" IS NULL
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

COMMIT;
