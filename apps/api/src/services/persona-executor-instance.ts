/**
 * Persona Executor Instance
 *
 * Singleton instance of PersonaActionExecutor configured for the API server.
 */

import { PersonaActionExecutor } from '@vea/core';
import type {
  VPAOrchestrator,
  PersonaActionLogger,
  PersonaAction,
} from '@vea/core';
import { createTenantClient } from '@ocsuite/db';
import { apiLogger } from '../utils/logger.js';

const mockOrchestrator: VPAOrchestrator = {
  async executeVPATool(tool, action, parameters, userId) {
    // Mock implementation - replace with real VPA-Core
    return {
      success: true,
      summary: `Executed ${tool}.${action}`,
      data: parameters,
      metadata: {
        executionTime: 100,
        timestamp: new Date(),
        module: 'mock' as any,
      },
    };
  },
};

class DatabasePersonaActionLogger implements PersonaActionLogger {
  async logAction(action: PersonaAction, userId: string, tenantId: string): Promise<void> {
    const db = createTenantClient({ tenantId, userId });
    try {
      await db.personaAction.create({
        data: {
          tenantId,
          userId,
          personaId: action.request.personaId,
          tool: action.request.tool,
          action: action.request.action,
          parameters: action.request.parameters as any,
          status: action.status as any,
          riskScore: action.riskScore,
          requiresApproval: action.requiresApproval,
          result: action.result as any,
        },
      });
    } finally {
      await db.$disconnect();
    }
  }

  async getRecentActions(userId: string, tenantId: string, limit: number = 10) {
    const db = createTenantClient({ tenantId, userId });
    try {
      return await db.personaAction.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } finally {
      await db.$disconnect();
    }
  }

  async getMeetingActions(userId: string, tenantId: string, meetingId: string) {
    return this.getRecentActions(userId, tenantId, 50);
  }

  async getPendingActions(userId: string, tenantId: string) {
    const db = createTenantClient({ tenantId, userId });
    try {
      return await db.personaAction.findMany({
        where: {
          tenantId,
          userId,
          status: 'pending',
          requiresApproval: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } finally {
      await db.$disconnect();
    }
  }
}

export const personaExecutor = new PersonaActionExecutor({
  orchestrator: mockOrchestrator,
  logger: new DatabasePersonaActionLogger(),
  requireApproval: process.env.VEA_REQUIRE_APPROVAL === 'true',
  riskThreshold: parseInt(process.env.VEA_RISK_THRESHOLD || '75', 10),
});
