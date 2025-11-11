-- Migration: Add Persona Actions Table
-- Description: Creates the persona_actions table for VEA integration
-- Created: 2025-01-11
-- Run this migration after setting up DATABASE_URL

-- Create PersonaActionStatus enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PersonaActionStatus') THEN
        CREATE TYPE "PersonaActionStatus" AS ENUM ('pending', 'approved', 'executing', 'completed', 'failed', 'denied', 'cancelled');
    END IF;
END$$;

-- Create persona_actions table
CREATE TABLE IF NOT EXISTS persona_actions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    meeting_id TEXT,
    persona_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    action TEXT NOT NULL,
    parameters JSONB NOT NULL,
    reasoning TEXT,
    status "PersonaActionStatus" NOT NULL DEFAULT 'pending',
    risk_score INTEGER NOT NULL,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    result JSONB,
    execution_time_ms INTEGER,
    approved_by TEXT,
    approved_at TIMESTAMP(3),
    denied_by TEXT,
    denied_at TIMESTAMP(3),
    denial_reason TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Foreign key constraint
    CONSTRAINT persona_actions_tenant_id_fkey
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS persona_actions_tenant_id_user_id_idx
    ON persona_actions(tenant_id, user_id);

CREATE INDEX IF NOT EXISTS persona_actions_tenant_id_persona_id_idx
    ON persona_actions(tenant_id, persona_id);

CREATE INDEX IF NOT EXISTS persona_actions_tenant_id_meeting_id_idx
    ON persona_actions(tenant_id, meeting_id);

CREATE INDEX IF NOT EXISTS persona_actions_status_idx
    ON persona_actions(status);

CREATE INDEX IF NOT EXISTS persona_actions_created_at_idx
    ON persona_actions(created_at DESC);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_persona_actions_updated_at ON persona_actions;
CREATE TRIGGER update_persona_actions_updated_at
    BEFORE UPDATE ON persona_actions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add helpful comments
COMMENT ON TABLE persona_actions IS 'Stores all persona actions executed through VEA for audit trail';
COMMENT ON COLUMN persona_actions.persona_id IS 'C-suite persona: ceo, cfo, cmo, or cto';
COMMENT ON COLUMN persona_actions.tool IS 'VPA tool name: vpa_prospects, vpa_email, etc.';
COMMENT ON COLUMN persona_actions.action IS 'Tool action: search, create_campaign, etc.';
COMMENT ON COLUMN persona_actions.risk_score IS 'Risk score 0-100 for approval workflow';
COMMENT ON COLUMN persona_actions.result IS 'JSON result from tool execution';

-- Success message
SELECT 'PersonaAction table created successfully!' as message;
