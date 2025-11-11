import type { PrismaClient } from '@ocsuite/db';
import type { TaskExecutionResult } from '@ocsuite/module-sdk';
import type { Logger } from 'pino';
import { validateTaskResult, formatValidationErrors } from '@ocsuite/module-sdk/validation';
import { GrowthPulseOutputSchema } from '@ocsuite/module-sdk';
import { growthPulseCapabilityDefinition, growthPulseExecution } from './growth-pulse/index.js';

export interface ModuleExecutionLogger extends Logger {}

export interface ModuleExecutionContext {
  moduleSlug: string;
  capability: string;
  tenantId: string;
  actorId: string;
  taskId: string;
  approvalId: string;
  payload: Record<string, unknown>;
  db: PrismaClient;
  logger: ModuleExecutionLogger;
}

export class ModuleExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleExecutionError';
  }
}

interface CapabilityHandler {
  execute: (context: ModuleExecutionContext) => Promise<TaskExecutionResult>;
}

interface ModuleRegistryEntry {
  capabilities: Record<string, CapabilityHandler>;
}

const moduleRegistry: Record<string, ModuleRegistryEntry> = {
  'growth-pulse': {
    capabilities: {
      [growthPulseCapabilityDefinition.name]: {
        execute: async (context) => {
          const { payload, tenantId, actorId, db, logger, taskId } = context;
          const startedAt = new Date();

          const outputs = await growthPulseExecution(payload, { tenantId, actorId, db, logger });
          const parsedOutputs = GrowthPulseOutputSchema.parse(outputs);

          const completedAt = new Date();

          const result: TaskExecutionResult = {
            taskId,
            success: true,
            outputs: parsedOutputs,
            metadata: {
              durationMs: completedAt.getTime() - startedAt.getTime(),
              startedAt: startedAt.toISOString(),
              completedAt: completedAt.toISOString(),
              workerId: 'action-executor',
              extra: {
                moduleSlug: context.moduleSlug,
                capability: context.capability,
                approvalId: context.approvalId,
              },
            },
          };

          const validation = validateTaskResult(result);
          if (!validation.success) {
            throw new ModuleExecutionError(
              `Module produced invalid result: ${formatValidationErrors(validation.errors)}`
            );
          }

          return result;
        },
      },
    },
  },
};

function getCapabilityHandler(moduleSlug: string, capability: string): CapabilityHandler {
  const moduleEntry = moduleRegistry[moduleSlug];

  if (!moduleEntry) {
    throw new ModuleExecutionError(`Unknown module slug: ${moduleSlug}`);
  }

  const handler = moduleEntry.capabilities[capability];

  if (!handler) {
    throw new ModuleExecutionError(`Module ${moduleSlug} does not expose capability ${capability}`);
  }

  return handler;
}

export async function executeModuleCapability(
  context: ModuleExecutionContext
): Promise<TaskExecutionResult> {
  const handler = getCapabilityHandler(context.moduleSlug, context.capability);
  const result = await handler.execute(context);

  const validation = validateTaskResult(result);
  if (!validation.success) {
    throw new ModuleExecutionError(
      `Capability execution returned invalid result: ${formatValidationErrors(validation.errors)}`
    );
  }

  return result;
}
