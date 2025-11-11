/**
 * Core types for VEA (Virtual Executive Assistant)
 */

export type PersonaId = 'ceo' | 'cfo' | 'cmo' | 'cto';

export type ModuleId =
  | 'prospect-finder'
  | 'leadtracker-pro'
  | 'email-orchestrator'
  | 'bookkeeping-assistant'
  | 'calendar-meeting-agent'
  | 'client-onboarding-agent'
  | 'content-writer'
  | 'image-studio-mcp'
  | 'proposal-contract-agent'
  | 'reputation-review-agent'
  | 'research-insights'
  | 'retention-renewal-agent'
  | 'social-media-manager'
  | 'support-agent'
  | 'task-project-manager'
  | 'time-billing-agent';

export type VPAToolName =
  | 'vpa_prospects'
  | 'vpa_pipeline'
  | 'vpa_email'
  | 'vpa_tasks'
  | 'vpa_research'
  | 'vpa_status'
  | 'vpa_modules'
  | 'vpa_configure'
  | 'vpa_metrics_dashboard';

/**
 * Tool definition with metadata
 */
export interface ToolDefinition {
  /** VPA tool name (e.g., 'vpa_prospects') */
  tool: VPAToolName;

  /** Human-readable name */
  name: string;

  /** What this tool does */
  description: string;

  /** Available actions (e.g., ['search', 'enrich', 'export']) */
  actions: string[];

  /** Which module(s) this tool uses */
  modules: ModuleId[];

  /** Example usage */
  example?: string;
}

/**
 * Persona's access to tools
 */
export interface PersonaToolAccess {
  personaId: PersonaId;

  /** Modules this persona can access */
  allowedModules: ModuleId[] | '*';

  /** Preferred tools for this persona */
  preferredTools: ToolDefinition[];

  /** Tools this persona should avoid (safety/role boundaries) */
  restrictedTools?: VPAToolName[];
}

/**
 * Action request from a persona
 */
export interface PersonaActionRequest {
  /** Which persona is making the request */
  personaId: PersonaId;

  /** Tool to execute */
  tool: VPAToolName;

  /** Action within that tool */
  action: string;

  /** Parameters for the action */
  parameters: Record<string, any>;

  /** Why the persona chose this action */
  reasoning: string;

  /** Optional: Expected outcome */
  expectedOutcome?: string;
}

/**
 * Result of executing a persona action
 */
export interface PersonaActionResult {
  /** Was execution successful? */
  success: boolean;

  /** Result data from the tool */
  data?: any;

  /** Error message if failed */
  error?: string;

  /** Execution metadata */
  metadata: {
    /** Time taken (ms) */
    executionTime: number;

    /** Timestamp */
    timestamp: Date;

    /** Which module was used */
    module: ModuleId;

    /** Cost (if applicable) */
    cost?: number;
  };
}

/**
 * Complete persona action with request and result
 */
export interface PersonaAction {
  /** The original request */
  request: PersonaActionRequest;

  /** The result (if executed) */
  result?: PersonaActionResult;

  /** Current status */
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'denied';

  /** User approval required? */
  requiresApproval: boolean;

  /** Risk score (0-100, higher = more risky) */
  riskScore: number;
}

/**
 * Context shared between personas in a board meeting
 */
export interface BoardMeetingContext {
  /** Meeting ID */
  meetingId: string;

  /** Tenant ID */
  tenantId: string;

  /** User ID */
  userId: string;

  /** Actions executed so far in this meeting */
  executedActions: PersonaAction[];

  /** Actions pending approval */
  pendingActions: PersonaAction[];

  /** Shared insights from previous persona turns */
  sharedInsights: Array<{
    personaId: PersonaId;
    insight: string;
    actionTaken?: PersonaActionRequest;
  }>;
}

/**
 * Error thrown when persona doesn't have access to a tool
 */
export class PersonaAccessDeniedError extends Error {
  constructor(
    public personaId: PersonaId,
    public tool: VPAToolName,
    message?: string
  ) {
    super(message || `${personaId} does not have access to ${tool}`);
    this.name = 'PersonaAccessDeniedError';
  }
}

/**
 * Error thrown when tool execution fails
 */
export class ToolExecutionError extends Error {
  constructor(
    public tool: VPAToolName,
    public action: string,
    message?: string,
    public originalError?: Error
  ) {
    super(message || `Failed to execute ${tool}.${action}`);
    this.name = 'ToolExecutionError';
  }
}
