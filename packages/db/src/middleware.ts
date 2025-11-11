import { Prisma } from '@prisma/client';

/**
 * Tenant context that must be provided for all database operations
 */
export interface TenantContext {
  tenantId: string;
  userId?: string;
}

/**
 * Error thrown when attempting to access database without tenant context
 */
export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

/**
 * Models that require tenant isolation
 * These models must have a tenantId field that will be automatically injected
 */
const TENANT_SCOPED_MODELS = [
  // Phase 1 Models
  'TenantMember',
  'Conversation',
  'Message',
  'Connector',
  'Task',
  'UsageSnapshot',
  'KnowledgeEntry',
  'KnowledgeSource',
  'BusinessProfile',
  // Phase 2 Models
  'ModuleInsight',
  'AnalyticsSnapshot',
  // Phase 3 Models
  'BoardMeeting',
  'BoardPersonaTurn',
  'BoardActionItem',
  // Phase 4 Models
  'ActionApproval',
  'Notification',
  'NotificationPreference',
  // Phase 6 Models
  'TriggerRule',
  'Alert',
  'TenantWidget',
  'BillingUsage',
] as const;

/**
 * Models that don't require tenant isolation
 * These are global models accessible across all tenants
 */
const GLOBAL_MODELS = ['Tenant', 'User'] as const;

const NULLABLE_TENANT_MODELS = new Set(['KnowledgeEntry', 'KnowledgeSource']);

type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];
type GlobalModel = (typeof GLOBAL_MODELS)[number];

/**
 * Check if a model requires tenant isolation
 */
function isTenantScopedModel(model: string): model is TenantScopedModel {
  return TENANT_SCOPED_MODELS.includes(model as TenantScopedModel);
}

/**
 * Check if a model is a global model
 */
function isGlobalModel(model: string): model is GlobalModel {
  return GLOBAL_MODELS.includes(model as GlobalModel);
}

/**
 * Creates a Prisma middleware that enforces tenant isolation
 *
 * This middleware automatically:
 * 1. Injects tenantId into all queries for tenant-scoped models
 * 2. Validates that tenantId is provided in context
 * 3. Prevents cross-tenant data access
 * 4. Handles special cases like KnowledgeEntry (can be null for company-wide data)
 *
 * @param context - Tenant context containing tenantId and optional userId
 * @returns Prisma middleware function
 *
 * @example
 * ```ts
 * const prisma = new PrismaClient();
 * const context = { tenantId: 'tenant-123', userId: 'user-456' };
 * prisma.$use(createTenantMiddleware(context));
 *
 * // This query will automatically be scoped to tenant-123
 * const conversations = await prisma.conversation.findMany();
 * ```
 */
export function createTenantMiddleware(
  context: TenantContext
): Prisma.Middleware {
  return async (params, next) => {
    const { model, action } = params;

    // Allow operations on global models without tenant context
    if (model && isGlobalModel(model)) {
      return next(params);
    }

    // Validate tenant context exists for tenant-scoped operations
    if (model && isTenantScopedModel(model)) {
      if (!context.tenantId) {
        throw new TenantContextError(
          `Tenant context required for ${model} operations. ` +
          `Ensure tenantId is provided in context.`
        );
      }

      // Inject tenantId into query operations
      if (action === 'findUnique' || action === 'findFirst') {
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.where) {
          params.args.where = {};
        }

        // Handle models that allow tenantId to be null for shared data
        if (NULLABLE_TENANT_MODELS.has(model)) {
          // If tenantId is explicitly set to null, allow it (company-wide knowledge)
          if (params.args.where.tenantId === null) {
            // Allow the query as-is for company-wide entries
          } else if (!params.args.where.tenantId) {
            // If no tenantId specified, default to current tenant
            params.args.where.tenantId = context.tenantId;
          }
        } else {
          // For all other tenant-scoped models, enforce tenantId
          params.args.where.tenantId = context.tenantId;
        }
      }

      if (action === 'findMany') {
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.where) {
          params.args.where = {};
        }

        // For nullable models, allow querying both tenant-specific and company-wide
        if (NULLABLE_TENANT_MODELS.has(model)) {
          if (!params.args.where.tenantId) {
            // Query both tenant-specific and company-wide entries
            params.args.where = {
              ...params.args.where,
              OR: [
                { tenantId: context.tenantId },
                { tenantId: null },
              ],
            };
          }
        } else {
          // For all other models, enforce strict tenant isolation
          params.args.where.tenantId = context.tenantId;
        }
      }

      if (action === 'count' || action === 'aggregate') {
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.where) {
          params.args.where = {};
        }

        if (NULLABLE_TENANT_MODELS.has(model)) {
          if (!params.args.where.tenantId) {
            params.args.where = {
              ...params.args.where,
              OR: [
                { tenantId: context.tenantId },
                { tenantId: null },
              ],
            };
          }
        } else {
          params.args.where.tenantId = context.tenantId;
        }
      }

      if (action === 'groupBy') {
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.where) {
          params.args.where = {};
        }

        if (NULLABLE_TENANT_MODELS.has(model)) {
          if (!params.args.where.tenantId) {
            params.args.where = {
              ...params.args.where,
              OR: [
                { tenantId: context.tenantId },
                { tenantId: null },
              ],
            };
          }
        } else {
          params.args.where.tenantId = context.tenantId;
        }
      }

      if (action === 'create') {
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.data) {
          params.args.data = {};
        }

        // For nullable models, allow explicit null tenantId for company-wide entries
        if (NULLABLE_TENANT_MODELS.has(model)) {
          if (!('tenantId' in params.args.data)) {
            // If not explicitly set, use current tenant
            params.args.data.tenantId = context.tenantId;
          }
          // If explicitly set to null, allow it for company-wide entries
        } else {
          // For all other models, always inject tenantId
          params.args.data.tenantId = context.tenantId;
        }
      }

      if (action === 'update' || action === 'updateMany') {
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.where) {
          params.args.where = {};
        }

        // Ensure updates only affect records in the current tenant
        if (NULLABLE_TENANT_MODELS.has(model)) {
          // For models allowing shared rows, maintain existing tenantId logic
          if (!params.args.where.tenantId) {
            params.args.where = {
              ...params.args.where,
              OR: [
                { tenantId: context.tenantId },
                { tenantId: null },
              ],
            };
          }
        } else {
          params.args.where.tenantId = context.tenantId;
        }
      }

      if (action === 'delete' || action === 'deleteMany') {
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.where) {
          params.args.where = {};
        }

        // Ensure deletes only affect records in the current tenant
        if (NULLABLE_TENANT_MODELS.has(model)) {
          if (!params.args.where.tenantId) {
            params.args.where = {
              ...params.args.where,
              OR: [
                { tenantId: context.tenantId },
                { tenantId: null },
              ],
            };
          }
        } else {
          params.args.where.tenantId = context.tenantId;
        }
      }

      if (action === 'upsert') {
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.where) {
          params.args.where = {};
        }
        if (!params.args.create) {
          params.args.create = {};
        }
        if (!params.args.update) {
          params.args.update = {};
        }

        // Enforce tenant isolation on all upsert operations
        if (NULLABLE_TENANT_MODELS.has(model)) {
          if (!('tenantId' in params.args.create)) {
            params.args.create.tenantId = context.tenantId;
          }
          if (!params.args.where.tenantId) {
            params.args.where.tenantId = context.tenantId;
          }
        } else {
          params.args.where.tenantId = context.tenantId;
          params.args.create.tenantId = context.tenantId;
        }
      }
    }

    return next(params);
  };
}

/**
 * Creates a Prisma middleware for audit logging
 *
 * This middleware automatically updates timestamps for create/update operations.
 * Note: Prisma already handles @updatedAt, but this can be extended for custom
 * audit fields like updatedBy, version, etc.
 *
 * @param context - Tenant context containing userId for audit trail
 * @returns Prisma middleware function
 */
export function createAuditMiddleware(
  _context: TenantContext
): Prisma.Middleware {
  return async (params, next) => {
    const { action } = params;

    // Add custom audit fields if needed in the future
    // For now, Prisma's @updatedAt and @default(now()) handle timestamps
    if (action === 'create' || action === 'update') {
      // Future: Add updatedBy, createdBy fields
      // params.args.data.updatedBy = context.userId;
    }

    return next(params);
  };
}

/**
 * Helper function to apply all middlewares to a Prisma client
 *
 * @param prisma - PrismaClient instance
 * @param context - Tenant context
 *
 * @example
 * ```ts
 * const prisma = new PrismaClient();
 * const context = { tenantId: 'tenant-123', userId: 'user-456' };
 * applyMiddlewares(prisma, context);
 * ```
 */
export function applyMiddlewares(
  prisma: { $use: (middleware: Prisma.Middleware) => void },
  context: TenantContext
): void {
  prisma.$use(createTenantMiddleware(context));
  prisma.$use(createAuditMiddleware(context));
}
