/**
 * Persona Action Logger
 *
 * Logs persona actions to database for:
 * - Audit trails
 * - Board meeting context sharing
 * - Analytics
 * - Debugging
 */

import { prisma, createTenantClient } from '@ocsuite/db';
import type { PersonaActionLogger, PersonaAction } from '@vea/core';
import { logger } from '../utils/logger.js';

class DatabasePersonaActionLogger implements PersonaActionLogger {
  async logAction(
    action: PersonaAction,
    userId: string,
    tenantId: string
  ): Promise<void> {
    try {
      const db = createTenantClient({ tenantId, userId });

      await db.personaAction.create({
        data: {
          tenantId,
          userId,
          meetingId: null, // Will be set if action is part of a board meeting
          personaId: action.request.personaId,
          tool: action.request.tool,
          action: action.request.action,
          parameters: action.request.parameters,
          reasoning: action.request.reasoning,
          status: action.status,
          riskScore: action.riskScore,
          requiresApproval: action.requiresApproval,
          result: action.result || null,
          executionTimeMs: action.result?.metadata.executionTime || null,
          createdAt: new Date(),
        },
      });

      await db.$disconnect();

      logger.info('[PersonaActionLogger] Action logged', {
        tenantId,
        userId,
        personaId: action.request.personaId,
        tool: action.request.tool,
        action: action.request.action,
        status: action.status,
      });
    } catch (error: any) {
      logger.error('[PersonaActionLogger] Failed to log action', {
        error: error.message,
        tenantId,
        userId,
        action: action.request,
      });

      // Don't throw - logging failure shouldn't block action execution
    }
  }

  /**
   * Get recent actions for a user (for context/history)
   */
  async getRecentActions(
    userId: string,
    tenantId: string,
    limit: number = 10
  ): Promise<any[]> {
    try {
      const db = createTenantClient({ tenantId, userId });

      const actions = await db.personaAction.findMany({
        where: {
          tenantId,
          userId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
      });

      await db.$disconnect();

      return actions;
    } catch (error: any) {
      logger.error('[PersonaActionLogger] Failed to get recent actions', {
        error: error.message,
        tenantId,
        userId,
      });

      return [];
    }
  }

  /**
   * Get actions from a specific board meeting
   */
  async getMeetingActions(
    meetingId: string,
    tenantId: string,
    userId: string
  ): Promise<any[]> {
    try {
      const db = createTenantClient({ tenantId, userId });

      const actions = await db.personaAction.findMany({
        where: {
          tenantId,
          meetingId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      await db.$disconnect();

      return actions;
    } catch (error: any) {
      logger.error('[PersonaActionLogger] Failed to get meeting actions', {
        error: error.message,
        tenantId,
        meetingId,
      });

      return [];
    }
  }

  /**
   * Get pending actions (require approval)
   */
  async getPendingActions(userId: string, tenantId: string): Promise<any[]> {
    try {
      const db = createTenantClient({ tenantId, userId });

      const actions = await db.personaAction.findMany({
        where: {
          tenantId,
          userId,
          status: 'pending',
          requiresApproval: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      await db.$disconnect();

      return actions;
    } catch (error: any) {
      logger.error('[PersonaActionLogger] Failed to get pending actions', {
        error: error.message,
        tenantId,
        userId,
      });

      return [];
    }
  }

  /**
   * Update action status (for approval/denial)
   */
  async updateActionStatus(
    actionId: string,
    status: 'completed' | 'denied' | 'failed',
    updates: {
      approvedBy?: string;
      deniedBy?: string;
      denialReason?: string;
      result?: any;
    },
    tenantId: string,
    userId: string
  ): Promise<void> {
    try {
      const db = createTenantClient({ tenantId, userId });

      await db.personaAction.update({
        where: { id: actionId },
        data: {
          status,
          approvedBy: updates.approvedBy,
          approvedAt: updates.approvedBy ? new Date() : null,
          deniedBy: updates.deniedBy,
          deniedAt: updates.deniedBy ? new Date() : null,
          denialReason: updates.denialReason,
          result: updates.result || null,
          updatedAt: new Date(),
        },
      });

      await db.$disconnect();

      logger.info('[PersonaActionLogger] Action status updated', {
        actionId,
        status,
        tenantId,
      });
    } catch (error: any) {
      logger.error('[PersonaActionLogger] Failed to update action status', {
        error: error.message,
        actionId,
        tenantId,
      });
    }
  }

  /**
   * Get action statistics for analytics
   */
  async getActionStats(
    userId: string,
    tenantId: string,
    since?: Date
  ): Promise<{
    total: number;
    byPersona: Record<string, number>;
    byStatus: Record<string, number>;
    byTool: Record<string, number>;
  }> {
    try {
      const db = createTenantClient({ tenantId, userId });

      const whereClause = {
        tenantId,
        userId,
        ...(since && { createdAt: { gte: since } }),
      };

      const actions = await db.personaAction.findMany({
        where: whereClause,
        select: {
          personaId: true,
          status: true,
          tool: true,
        },
      });

      await db.$disconnect();

      const stats = {
        total: actions.length,
        byPersona: {} as Record<string, number>,
        byStatus: {} as Record<string, number>,
        byTool: {} as Record<string, number>,
      };

      actions.forEach((action) => {
        stats.byPersona[action.personaId] =
          (stats.byPersona[action.personaId] || 0) + 1;
        stats.byStatus[action.status] =
          (stats.byStatus[action.status] || 0) + 1;
        stats.byTool[action.tool] = (stats.byTool[action.tool] || 0) + 1;
      });

      return stats;
    } catch (error: any) {
      logger.error('[PersonaActionLogger] Failed to get action stats', {
        error: error.message,
        tenantId,
        userId,
      });

      return {
        total: 0,
        byPersona: {},
        byStatus: {},
        byTool: {},
      };
    }
  }
}

/**
 * Singleton instance
 */
export const personaActionLogger = new DatabasePersonaActionLogger();
