/**
 * @vea/core - Virtual Executive Assistant Core
 *
 * Enables C-suite AI personas to execute actions through MCP modules
 */

// Types
export type {
  PersonaId,
  ModuleId,
  VPAToolName,
  ToolDefinition,
  PersonaToolAccess,
  PersonaActionRequest,
  PersonaActionResult,
  PersonaAction,
  BoardMeetingContext,
} from './types.js';

export { PersonaAccessDeniedError, ToolExecutionError } from './types.js';

// Persona Tools Registry
export {
  getPersonaTools,
  canPersonaAccessTool,
  getPersonaModules,
  getAllTools,
  getToolDefinition,
  formatToolsForPrompt,
  PERSONA_TOOL_REGISTRY,
} from './persona-tools.js';

// Persona Action Executor
export {
  PersonaActionExecutor,
  parseActionRequest,
  formatActionResultForContext,
} from './persona-executor.js';

export type {
  VPAOrchestrator,
  PersonaActionLogger,
  PersonaExecutorConfig,
} from './persona-executor.js';
