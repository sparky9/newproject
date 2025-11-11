-- Phase 7: Access logging table for security audit trail
-- Captures HTTP request metadata emitted by the API middleware and enforces
-- tenant-scoped row level security. Logs may be system-wide (tenantId NULL)
-- when requests occur before tenant context is resolved.

BEGIN;

CREATE TABLE IF NOT EXISTS "access_logs" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT,
  "userId" TEXT,
  "method" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "durationMs" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE "access_logs"
  ADD CONSTRAINT access_logs_tenant_fkey
  FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "access_logs"
  ADD CONSTRAINT access_logs_user_fkey
  FOREIGN KEY ("userId") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS access_logs_tenant_idx
  ON "access_logs" ("tenantId");

CREATE INDEX IF NOT EXISTS access_logs_user_idx
  ON "access_logs" ("userId");

CREATE INDEX IF NOT EXISTS access_logs_created_at_idx
  ON "access_logs" ("createdAt");

ALTER TABLE "access_logs" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "access_logs_tenant_select"
    ON "access_logs"
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
  CREATE POLICY "access_logs_tenant_insert"
    ON "access_logs"
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
  CREATE POLICY "access_logs_tenant_delete"
    ON "access_logs"
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
