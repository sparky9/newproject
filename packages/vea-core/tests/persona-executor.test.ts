/**
 * Test: Persona Action Executor
 *
 * Validates:
 * - Action execution with mock orchestrator
 * - Access control enforcement
 * - Risk scoring
 * - Approval workflow
 */

import {
  PersonaActionExecutor,
  parseActionRequest,
  formatActionResultForContext,
  type VPAOrchestrator,
  type PersonaActionLogger,
} from '../src/index';

// Mock VPA Orchestrator
const mockOrchestrator: VPAOrchestrator = {
  async executeVPATool(tool, action, parameters, userId) {
    return {
      success: true,
      summary: `Mock execution of ${tool}.${action}`,
      data: { tool, action, parameters, userId },
    };
  },
};

// Mock Logger
const mockLogger: PersonaActionLogger = {
  async logAction(action, userId, tenantId) {
    console.log(`[MockLogger] Logged action: ${action.request.personaId} -> ${action.request.tool}`);
  },
};

describe('PersonaActionExecutor', () => {
  let executor: PersonaActionExecutor;

  beforeEach(() => {
    executor = new PersonaActionExecutor({
      orchestrator: mockOrchestrator,
      logger: mockLogger,
      requireApproval: false, // Disable for tests
      riskThreshold: 50,
    });
  });

  describe('executePersonaAction', () => {
    test('should execute valid action successfully', async () => {
      const action = await executor.executePersonaAction(
        {
          personaId: 'ceo',
          tool: 'vpa_prospects',
          action: 'search',
          parameters: { industry: 'HVAC', location: 'Dallas', limit: 50 },
          reasoning: 'Test search',
        },
        'test-user',
        'test-tenant'
      );

      expect(action.status).toBe('completed');
      expect(action.result?.success).toBe(true);
      expect(action.riskScore).toBeGreaterThanOrEqual(0);
    });

    test('should reject action if persona lacks access', async () => {
      await expect(
        executor.executePersonaAction(
          {
            personaId: 'cfo',
            tool: 'vpa_content', // CFO cannot access content
            action: 'generate_blog',
            parameters: {},
            reasoning: 'Should fail',
          },
          'test-user',
          'test-tenant'
        )
      ).rejects.toThrow('does not have permission');
    });

    test('should calculate risk score correctly', async () => {
      // Low risk action (read-only)
      const readAction = await executor.executePersonaAction(
        {
          personaId: 'ceo',
          tool: 'vpa_prospects',
          action: 'search',
          parameters: { limit: 10 },
          reasoning: 'Safe search',
        },
        'test-user',
        'test-tenant'
      );

      expect(readAction.riskScore).toBeLessThan(30);

      // Higher risk action (bulk operation)
      const bulkAction = await executor.executePersonaAction(
        {
          personaId: 'ceo',
          tool: 'vpa_pipeline',
          action: 'import',
          parameters: { limit: 500 },
          reasoning: 'Bulk import',
        },
        'test-user',
        'test-tenant'
      );

      expect(bulkAction.riskScore).toBeGreaterThan(readAction.riskScore);
    });

    test('should require approval for high-risk actions when enabled', async () => {
      const strictExecutor = new PersonaActionExecutor({
        orchestrator: mockOrchestrator,
        requireApproval: true,
        riskThreshold: 30,
      });

      const action = await strictExecutor.executePersonaAction(
        {
          personaId: 'ceo',
          tool: 'vpa_pipeline',
          action: 'bulk_delete',
          parameters: { ids: [1, 2, 3] },
          reasoning: 'High risk action',
        },
        'test-user',
        'test-tenant'
      );

      expect(action.status).toBe('pending');
      expect(action.requiresApproval).toBe(true);
      expect(action.riskScore).toBeGreaterThan(30);
    });
  });

  describe('parseActionRequest', () => {
    test('should parse valid action request from LLM response', () => {
      const llmResponse = `I'll help you find those leads.

{
  "type": "action",
  "personaId": "ceo",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": {"industry": "HVAC", "location": "Dallas", "limit": 50},
  "reasoning": "Finding HVAC companies as requested"
}

Let me know what you'd like to do with them.`;

      const actionRequest = parseActionRequest(llmResponse);

      expect(actionRequest).not.toBeNull();
      expect(actionRequest?.personaId).toBe('ceo');
      expect(actionRequest?.tool).toBe('vpa_prospects');
      expect(actionRequest?.action).toBe('search');
      expect(actionRequest?.parameters.industry).toBe('HVAC');
    });

    test('should return null for response without action', () => {
      const llmResponse = 'I recommend you search for HVAC companies in Dallas.';

      const actionRequest = parseActionRequest(llmResponse);

      expect(actionRequest).toBeNull();
    });

    test('should return null for malformed JSON', () => {
      const llmResponse = 'Here is the data: { invalid json }';

      const actionRequest = parseActionRequest(llmResponse);

      expect(actionRequest).toBeNull();
    });
  });

  describe('formatActionResultForContext', () => {
    test('should format completed action', () => {
      const action = {
        request: {
          personaId: 'ceo' as const,
          tool: 'vpa_prospects' as const,
          action: 'search',
          parameters: {},
          reasoning: 'Test',
        },
        result: {
          success: true,
          data: { summary: 'Found 50 companies' },
          metadata: {
            executionTime: 500,
            timestamp: new Date(),
            module: 'prospect-finder' as any,
          },
        },
        status: 'completed' as const,
        requiresApproval: false,
        riskScore: 10,
      };

      const formatted = formatActionResultForContext(action);

      expect(formatted).toContain('CEO');
      expect(formatted).toContain('successfully');
      expect(formatted).toContain('vpa_prospects');
    });

    test('should format pending action', () => {
      const action = {
        request: {
          personaId: 'cfo' as const,
          tool: 'vpa_bookkeeping' as const,
          action: 'generate_invoice',
          parameters: {},
          reasoning: 'Test',
        },
        status: 'pending' as const,
        requiresApproval: true,
        riskScore: 60,
      };

      const formatted = formatActionResultForContext(action);

      expect(formatted).toContain('CFO');
      expect(formatted).toContain('requires approval');
      expect(formatted).toContain('60');
    });
  });
});

console.log('✅ All Persona Action Executor tests defined');
