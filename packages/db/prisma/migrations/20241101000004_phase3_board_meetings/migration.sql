-- Phase 3 Migration: Board Meeting Orchestrator
--
-- Adds board meeting tables, action items, persona turns, and links tasks.

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE "BoardActionStatus" AS ENUM ('open', 'in_progress', 'completed');

-- ============================================================================
-- TABLES
-- ============================================================================

CREATE TABLE "board_meetings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "agenda" JSONB NOT NULL,
    "agenda_version" INTEGER NOT NULL DEFAULT 1,
    "outcome_summary" TEXT,
    "token_usage" JSONB,
    "rating" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_meetings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "board_persona_turns" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "role" "PersonaType",
    "content" TEXT NOT NULL,
    "metrics" JSONB,
    "sequence" INTEGER NOT NULL,
    "streamed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_persona_turns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "board_action_items" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "BoardActionStatus" NOT NULL DEFAULT 'open',
    "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
    "assignee_id" TEXT,
    "due_date" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_action_items_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- ALTER EXISTING TABLES
-- ============================================================================

ALTER TABLE "tasks"
  ADD COLUMN "board_action_item_id" TEXT;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX "board_meetings_tenant_id_created_at_idx" ON "board_meetings" ("tenant_id", "created_at");
CREATE INDEX "board_persona_turns_tenant_meeting_idx" ON "board_persona_turns" ("tenant_id", "meeting_id");
CREATE INDEX "board_persona_turns_meeting_sequence_idx" ON "board_persona_turns" ("meeting_id", "sequence");
CREATE INDEX "board_action_items_tenant_meeting_idx" ON "board_action_items" ("tenant_id", "meeting_id");
CREATE INDEX "board_action_items_status_idx" ON "board_action_items" ("status");
CREATE INDEX "board_action_items_assignee_idx" ON "board_action_items" ("assignee_id");
CREATE INDEX "tasks_board_action_item_id_idx" ON "tasks" ("board_action_item_id");

-- ============================================================================
-- FOREIGN KEYS
-- ============================================================================

ALTER TABLE "board_meetings"
  ADD CONSTRAINT "board_meetings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "board_persona_turns"
  ADD CONSTRAINT "board_persona_turns_meeting_id_fkey"
  FOREIGN KEY ("meeting_id") REFERENCES "board_meetings" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "board_persona_turns_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "board_action_items"
  ADD CONSTRAINT "board_action_items_meeting_id_fkey"
  FOREIGN KEY ("meeting_id") REFERENCES "board_meetings" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "board_action_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "board_action_items_assignee_id_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "tenant_members" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_board_action_item_id_fkey"
  FOREIGN KEY ("board_action_item_id") REFERENCES "board_action_items" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE "board_meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_persona_turns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_action_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_meetings_tenant_isolation_select"
  ON "board_meetings"
  FOR SELECT
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_meetings_tenant_isolation_insert"
  ON "board_meetings"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_meetings_tenant_isolation_update"
  ON "board_meetings"
  FOR UPDATE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_meetings_tenant_isolation_delete"
  ON "board_meetings"
  FOR DELETE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_persona_turns_tenant_isolation_select"
  ON "board_persona_turns"
  FOR SELECT
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_persona_turns_tenant_isolation_insert"
  ON "board_persona_turns"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_persona_turns_tenant_isolation_update"
  ON "board_persona_turns"
  FOR UPDATE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_persona_turns_tenant_isolation_delete"
  ON "board_persona_turns"
  FOR DELETE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_action_items_tenant_isolation_select"
  ON "board_action_items"
  FOR SELECT
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_action_items_tenant_isolation_insert"
  ON "board_action_items"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_action_items_tenant_isolation_update"
  ON "board_action_items"
  FOR UPDATE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "board_action_items_tenant_isolation_delete"
  ON "board_action_items"
  FOR DELETE
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE "board_meetings" IS 'Stores orchestrated board meeting runs and overall summaries per tenant.';
COMMENT ON TABLE "board_persona_turns" IS 'Persona-level contributions captured during board meetings in sequence order.';
COMMENT ON TABLE "board_action_items" IS 'Action items generated from board meetings with ownership and due dates.';
