/**
 * Persona Action Executor
 *
 * The bridge between AI persona responses and actual tool execution.
 * This validates access, executes tools, and logs actions for context.
 */

import type {
  PersonaId,
  PersonaActionRequest,
  PersonaActionResult,
  PersonaAction,
  VPAToolName,
} from './types.js';
import { PersonaAccessDeniedError, ToolExecutionError } from './types.js';
import { canPersonaAccessTool, getToolDefinition } from './persona-tools.js';

/**
 * Interface for VPA orchestrator (will be implemented by integrating code)
 */
export interface VPAOrchestrator {
  /**
   * Execute a VPA tool
   * This will be the actual executeVPATool from vpa-core/src/orchestrator.ts
   */
  executeVPATool(
    tool: string,
    action: string,
    parameters: any,
    userId: string
  ): Promise<any>;
}

/**
 * Interface for action logging (will be implemented by integrating code)
 */
export interface PersonaActionLogger {
  /**
   * Log a persona action for audit and board meeting context
   */
  logAction(action: PersonaAction, userId: string, tenantId: string): Promise<void>;
}

/**
 * Configuration for persona executor
 */
export interface PersonaExecutorConfig {
  /** VPA orchestrator instance */
  orchestrator: VPAOrchestrator;

  /** Action logger instance */
  logger?: PersonaActionLogger;

  /** Should high-risk actions require approval? */
  requireApproval?: boolean;

  /** Risk threshold (0-100) above which approval is required */
  riskThreshold?: number;
}

/**
 * Calculate risk score for an action
 * Higher score = more risky
 */
function calculateRiskScore(request: PersonaActionRequest): number {
  let score = 0;

  // Base scores by action type
  const dangerousActions = ['delete', 'remove', 'purge', 'cancel'];
  const bulkActions = ['import', 'batch', 'bulk'];
  const financialActions = ['pay', 'invoice', 'charge', 'refund'];

  const action = request.action.toLowerCase();

  if (dangerousActions.some((da) => action.includes(da))) {
    score += 50; // Very risky
  }

  if (bulkActions.some((ba) => action.includes(ba))) {
    score += 30; // Moderately risky
  }

  if (financialActions.some((fa) => action.includes(fa))) {
    score += 40; // Financial risk
  }

  // Check parameter quantities
  const params = request.parameters;

  if (params.limit && typeof params.limit === 'number' && params.limit > 100) {
    score += 20; // Large batch operation
  }

  if (params.amount && typeof params.amount === 'number' && params.amount > 1000) {
    score += 30; // Large financial amount
  }

  // Read-only operations are low risk
  const readOnlyActions = ['get', 'list', 'search', 'find', 'show', 'view'];
  if (readOnlyActions.some((ro) => action.includes(ro))) {
    score = Math.max(0, score - 30); // Reduce risk for read operations
  }

  return Math.min(100, Math.max(0, score)); // Clamp between 0-100
}

/**
 * Persona Action Executor
 *
 * Executes tool calls on behalf of AI personas with:
 * - Access control validation
 * - Risk assessment
 * - Execution tracking
 * - Context logging
 */
export class PersonaActionExecutor {
  private orchestrator: VPAOrchestrator;
  private logger?: PersonaActionLogger;
  private requireApproval: boolean;
  private riskThreshold: number;

  constructor(config: PersonaExecutorConfig) {
    this.orchestrator = config.orchestrator;
    this.logger = config.logger;
    this.requireApproval = config.requireApproval ?? true;
    this.riskThreshold = config.riskThreshold ?? 50;
  }

  /**
   * Execute an action on behalf of a persona
   */
  async executePersonaAction(
    request: PersonaActionRequest,
    userId: string,
    tenantId: string
  ): Promise<PersonaAction> {
    const startTime = Date.now();

    // 1. Validate persona has access to this tool
    const hasAccess = canPersonaAccessTool(request.personaId, request.tool);

    if (!hasAccess) {
      throw new PersonaAccessDeniedError(
        request.personaId,
        request.tool,
        `${request.personaId.toUpperCase()} does not have permission to use ${request.tool}`
      );
    }

    // 2. Calculate risk score
    const riskScore = calculateRiskScore(request);

    // 3. Check if approval is required
    const requiresApproval = this.requireApproval && riskScore >= this.riskThreshold;

    if (requiresApproval) {
      // Return pending action for user approval
      const pendingAction: PersonaAction = {
        request,
        status: 'pending',
        requiresApproval: true,
        riskScore,
      };

      // Log the pending action
      if (this.logger) {
        await this.logger.logAction(pendingAction, userId, tenantId);
      }

      return pendingAction;
    }

    // 4. Execute the tool via VPA orchestrator
    let result: PersonaActionResult;

    try {
      const data = await this.orchestrator.executeVPATool(
        request.tool,
        request.action,
        request.parameters,
        userId
      );

      const executionTime = Date.now() - startTime;
      const toolDef = getToolDefinition(request.tool);

      result = {
        success: true,
        data,
        metadata: {
          executionTime,
          timestamp: new Date(),
          module: toolDef?.modules[0] || ('unknown' as any),
        },
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      const toolDef = getToolDefinition(request.tool);

      result = {
        success: false,
        error: error.message || 'Unknown error',
        metadata: {
          executionTime,
          timestamp: new Date(),
          module: toolDef?.modules[0] || ('unknown' as any),
        },
      };
    }

    // 5. Create completed action
    const action: PersonaAction = {
      request,
      result,
      status: result.success ? 'completed' : 'failed',
      requiresApproval: false,
      riskScore,
    };

    // 6. Log the completed action
    if (this.logger) {
      await this.logger.logAction(action, userId, tenantId);
    }

    return action;
  }

  /**
   * Batch execute multiple actions
   * Useful for board meetings where multiple personas execute in sequence
   */
  async executeBatchActions(
    requests: PersonaActionRequest[],
    userId: string,
    tenantId: string
  ): Promise<PersonaAction[]> {
    const results: PersonaAction[] = [];

    for (const request of requests) {
      const result = await this.executePersonaAction(request, userId, tenantId);
      results.push(result);

      // If an action requires approval or failed, stop batch execution
      if (result.status === 'pending' || result.status === 'failed') {
        break;
      }
    }

    return results;
  }

  /**
   * Approve and execute a pending action
   */
  async approvePendingAction(
    action: PersonaAction,
    userId: string,
    tenantId: string,
    approverComment?: string
  ): Promise<PersonaAction> {
    if (action.status !== 'pending') {
      throw new Error(`Cannot approve action with status: ${action.status}`);
    }

    const startTime = Date.now();

    // Execute the tool
    try {
      const data = await this.orchestrator.executeVPATool(
        action.request.tool,
        action.request.action,
        action.request.parameters,
        userId
      );

      const executionTime = Date.now() - startTime;
      const toolDef = getToolDefinition(action.request.tool);

      const result: PersonaActionResult = {
        success: true,
        data,
        metadata: {
          executionTime,
          timestamp: new Date(),
          module: toolDef?.modules[0] || ('unknown' as any),
        },
      };

      const completedAction: PersonaAction = {
        ...action,
        result,
        status: 'completed',
      };

      // Log the approved & executed action
      if (this.logger) {
        await this.logger.logAction(completedAction, userId, tenantId);
      }

      return completedAction;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      const toolDef = getToolDefinition(action.request.tool);

      const result: PersonaActionResult = {
        success: false,
        error: error.message || 'Unknown error',
        metadata: {
          executionTime,
          timestamp: new Date(),
          module: toolDef?.modules[0] || ('unknown' as any),
        },
      };

      const failedAction: PersonaAction = {
        ...action,
        result,
        status: 'failed',
      };

      // Log the failed action
      if (this.logger) {
        await this.logger.logAction(failedAction, userId, tenantId);
      }

      return failedAction;
    }
  }

  /**
   * Deny a pending action
   */
  async denyPendingAction(
    action: PersonaAction,
    userId: string,
    tenantId: string,
    denialReason?: string
  ): Promise<PersonaAction> {
    if (action.status !== 'pending') {
      throw new Error(`Cannot deny action with status: ${action.status}`);
    }

    const deniedAction: PersonaAction = {
      ...action,
      status: 'denied',
      result: {
        success: false,
        error: denialReason || 'Action denied by user',
        metadata: {
          executionTime: 0,
          timestamp: new Date(),
          module: getToolDefinition(action.request.tool)?.modules[0] || ('unknown' as any),
        },
      },
    };

    // Log the denial
    if (this.logger) {
      await this.logger.logAction(deniedAction, userId, tenantId);
    }

    return deniedAction;
  }
}

/**
 * Parse action request from LLM response
 * Looks for structured JSON in persona response
 */
export function parseActionRequest(
  llmResponse: string
): PersonaActionRequest | null {
  try {
    // Look for JSON block in response
    const jsonMatch = llmResponse.match(/\{[\s\S]*"type":\s*"action"[\s\S]*\}/);

    if (!jsonMatch) {
      return null;
    }

    const json = JSON.parse(jsonMatch[0]);

    if (json.type !== 'action') {
      return null;
    }

    // Validate required fields
    if (!json.personaId || !json.tool || !json.action || !json.parameters) {
      return null;
    }

    return {
      personaId: json.personaId,
      tool: json.tool,
      action: json.action,
      parameters: json.parameters,
      reasoning: json.reasoning || '',
      expectedOutcome: json.expectedOutcome,
    };
  } catch (error) {
    // Failed to parse, no action request in response
    return null;
  }
}

/**
 * Format action result for persona context
 * Creates a summary that can be shared with other personas
 */
export function formatActionResultForContext(action: PersonaAction): string {
  const { request, result, status } = action;

  if (status === 'pending') {
    return `${request.personaId.toUpperCase()} wants to execute ${request.tool}.${request.action} but requires approval (risk score: ${action.riskScore}/100)`;
  }

  if (status === 'denied') {
    return `${request.personaId.toUpperCase()}'s action was denied: ${result?.error}`;
  }

  if (status === 'failed') {
    return `${request.personaId.toUpperCase()} tried to execute ${request.tool}.${request.action} but it failed: ${result?.error}`;
  }

  if (status === 'completed' && result?.success) {
    const summary = result.data?.summary || `Executed ${request.tool}.${request.action}`;
    return `${request.personaId.toUpperCase()} successfully executed ${request.tool}.${request.action}: ${summary}`;
  }

  return `${request.personaId.toUpperCase()} action status: ${status}`;
}
