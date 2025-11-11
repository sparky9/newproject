-- Phase 5: Knowledge sources and enhanced knowledge entries
-- Adds knowledge_sources table and augments knowledge_entries with
-- richer metadata to support ingestion pipelines, retention, and
-- alternate storage strategies.

BEGIN;

-- Enum types for knowledge sources
DO $$
BEGIN
  CREATE TYPE "KnowledgeSourceType" AS ENUM ('file_upload', 'cloud_sync', 'manual_note', 'hq_share');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE "KnowledgeSourceProvider" AS ENUM ('upload', 'google_drive', 'notion', 'manual', 'hq', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('pending', 'syncing', 'ready', 'error', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE "KnowledgeStorageStrategy" AS ENUM ('managed_postgres', 'external_s3');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE "KnowledgeRetentionPolicy" AS ENUM ('retain_indefinitely', 'rolling_90_days', 'manual_purge');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- Create knowledge_sources table
CREATE TABLE IF NOT EXISTS knowledge_sources (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NULL,
  "name" TEXT NOT NULL,
  "type" "KnowledgeSourceType" NOT NULL,
  "provider" "KnowledgeSourceProvider" NOT NULL,
  "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'pending',
  "storage_strategy" "KnowledgeStorageStrategy" NOT NULL DEFAULT 'managed_postgres',
  "retention_policy" "KnowledgeRetentionPolicy" NOT NULL DEFAULT 'retain_indefinitely',
  "configuration" JSONB,
  "last_synced_at" TIMESTAMP,
  "last_error" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ownership reference back to tenants
ALTER TABLE knowledge_sources
  ADD CONSTRAINT knowledge_sources_tenant_fkey
  FOREIGN KEY ("tenantId") REFERENCES tenants("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Useful indexes for query patterns
CREATE INDEX IF NOT EXISTS knowledge_sources_tenant_idx ON knowledge_sources("tenantId");
CREATE INDEX IF NOT EXISTS knowledge_sources_status_idx ON knowledge_sources("status");

-- Extend knowledge_entries with metadata tied to sources and storage
ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS "sourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "checksum" TEXT,
  ADD COLUMN IF NOT EXISTS "chunk_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "token_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "embedding_metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "retention_expires_at" TIMESTAMP;

-- Relationship from entries back to their source
ALTER TABLE knowledge_entries
  ADD CONSTRAINT knowledge_entries_source_fkey
  FOREIGN KEY ("sourceId") REFERENCES knowledge_sources("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS knowledge_entries_source_id_idx ON knowledge_entries("sourceId");

-- Row Level Security for knowledge_sources mirrors knowledge_entries rules
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "knowledge_sources_tenant_isolation_select"
    ON knowledge_sources
    FOR SELECT
    USING (
      "tenantId" = current_setting('app.current_tenant_id', true)::text
      OR "tenantId" IS NULL
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "knowledge_sources_tenant_isolation_insert"
    ON knowledge_sources
    FOR INSERT
    WITH CHECK (
      "tenantId" = current_setting('app.current_tenant_id', true)::text
      OR "tenantId" IS NULL
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "knowledge_sources_tenant_isolation_update"
    ON knowledge_sources
    FOR UPDATE
    USING (
      "tenantId" = current_setting('app.current_tenant_id', true)::text
      OR "tenantId" IS NULL
    )
    WITH CHECK (
      "tenantId" = current_setting('app.current_tenant_id', true)::text
      OR "tenantId" IS NULL
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE POLICY "knowledge_sources_tenant_isolation_delete"
    ON knowledge_sources
    FOR DELETE
    USING (
      "tenantId" = current_setting('app.current_tenant_id', true)::text
      OR "tenantId" IS NULL
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

COMMIT;
