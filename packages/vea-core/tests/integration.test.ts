/**
 * Integration Test: End-to-End Workflow
 *
 * Simulates complete user interactions:
 * - CEO executing prospect search
 * - CFO generating invoices
 * - CMO creating campaigns
 * - Board meeting with multiple personas
 */

import {
  PersonaActionExecutor,
  getPersonaTools,
  formatToolsForPrompt,
  parseActionRequest,
  type VPAOrchestrator,
  type PersonaActionLogger,
  type PersonaAction,
} from '../src/index';

// Enhanced Mock Orchestrator with realistic responses
const realisticOrchestrator: VPAOrchestrator = {
  async executeVPATool(tool, action, parameters, userId) {
    // Simulate different tool responses
    if (tool === 'vpa_prospects' && action === 'search') {
      return {
        success: true,
        summary: `Found ${parameters.limit || 10} ${parameters.industry} companies in ${parameters.location}`,
        prospects: Array.from({ length: parameters.limit || 10 }, (_, i) => ({
          id: `prospect-${i + 1}`,
          name: `${parameters.industry} Company ${i + 1}`,
          location: parameters.location,
          phone: `555-${1000 + i}`,
          email: `contact@company${i + 1}.com`,
        })),
      };
    }

    if (tool === 'vpa_pipeline' && action === 'import') {
      return {
        success: true,
        summary: `Added ${parameters.prospects?.length || 0} prospects to pipeline`,
        imported: parameters.prospects?.length || 0,
        pipeline_value: (parameters.prospects?.length || 0) * 5000,
      };
    }

    if (tool === 'vpa_email' && action === 'create_campaign') {
      return {
        success: true,
        campaign_id: `camp-${Date.now()}`,
        name: parameters.name || 'Untitled Campaign',
        audience_size: parameters.audience_size || 0,
      };
    }

    if (tool === 'vpa_bookkeeping' && action === 'generate_invoice') {
      return {
        success: true,
        invoice_id: `inv-${Date.now()}`,
        amount: parameters.amount || 1000,
        client: parameters.client || 'Client',
      };
    }

    return { success: true, message: `Executed ${tool}.${action}` };
  },
};

// Track logged actions
const loggedActions: PersonaAction[] = [];

const trackingLogger: PersonaActionLogger = {
  async logAction(action, userId, tenantId) {
    loggedActions.push(action);
    console.log(`[Logger] ${action.request.personaId.toUpperCase()}: ${action.request.tool}.${action.request.action} -> ${action.status}`);
  },
};

describe('Integration Tests', () => {
  let executor: PersonaActionExecutor;

  beforeEach(() => {
    loggedActions.length = 0; // Clear logged actions
    executor = new PersonaActionExecutor({
      orchestrator: realisticOrchestrator,
      logger: trackingLogger,
      requireApproval: false,
      riskThreshold: 50,
    });
  });

  test('CEO can find prospects and get realistic results', async () => {
    const action = await executor.executePersonaAction(
      {
        personaId: 'ceo',
        tool: 'vpa_prospects',
        action: 'search',
        parameters: {
          industry: 'HVAC',
          location: 'Dallas',
          limit: 50,
        },
        reasoning: 'User requested HVAC leads',
      },
      'user-123',
      'tenant-456'
    );

    expect(action.status).toBe('completed');
    expect(action.result?.success).toBe(true);
    expect(action.result?.data.prospects).toHaveLength(50);
    expect(action.result?.data.summary).toContain('HVAC');
    expect(action.result?.data.summary).toContain('Dallas');
    expect(loggedActions).toHaveLength(1);
  });

  test('CFO can generate invoices', async () => {
    const action = await executor.executePersonaAction(
      {
        personaId: 'cfo',
        tool: 'vpa_bookkeeping',
        action: 'generate_invoice',
        parameters: {
          client: 'ACME Corp',
          amount: 5000,
        },
        reasoning: 'Generate invoice for completed project',
      },
      'user-123',
      'tenant-456'
    );

    expect(action.status).toBe('completed');
    expect(action.result?.success).toBe(true);
    expect(action.result?.data.invoice_id).toBeDefined();
    expect(action.result?.data.amount).toBe(5000);
    expect(action.result?.data.client).toBe('ACME Corp');
  });

  test('CMO can execute multi-step workflow', async () => {
    // Step 1: Find prospects
    const searchAction = await executor.executePersonaAction(
      {
        personaId: 'cmo',
        tool: 'vpa_prospects',
        action: 'search',
        parameters: { industry: 'HVAC', location: 'Dallas', limit: 50 },
        reasoning: 'Finding target prospects',
      },
      'user-123',
      'tenant-456'
    );

    expect(searchAction.status).toBe('completed');
    const prospects = searchAction.result?.data.prospects;

    // Step 2: Add to pipeline
    const importAction = await executor.executePersonaAction(
      {
        personaId: 'cmo',
        tool: 'vpa_pipeline',
        action: 'import',
        parameters: { prospects },
        reasoning: 'Adding prospects to CRM',
      },
      'user-123',
      'tenant-456'
    );

    expect(importAction.status).toBe('completed');
    expect(importAction.result?.data.imported).toBe(50);
    expect(importAction.result?.data.pipeline_value).toBe(250000); // 50 * $5k

    // Step 3: Create campaign
    const campaignAction = await executor.executePersonaAction(
      {
        personaId: 'cmo',
        tool: 'vpa_email',
        action: 'create_campaign',
        parameters: {
          name: 'Dallas HVAC Welcome',
          audience_size: 50,
        },
        reasoning: 'Creating welcome campaign',
      },
      'user-123',
      'tenant-456'
    );

    expect(campaignAction.status).toBe('completed');
    expect(campaignAction.result?.data.name).toBe('Dallas HVAC Welcome');

    // Verify all 3 actions were logged
    expect(loggedActions).toHaveLength(3);
    expect(loggedActions.every(a => a.request.personaId === 'cmo')).toBe(true);
  });

  test('Board meeting: Multiple personas coordinate', async () => {
    // CEO opens with strategy
    console.log('\n🎭 Board Meeting Simulation');
    console.log('CEO: "Let\'s target Dallas HVAC market"\n');

    // CMO executes prospect search
    const cmoAction1 = await executor.executePersonaAction(
      {
        personaId: 'cmo',
        tool: 'vpa_prospects',
        action: 'search',
        parameters: { industry: 'HVAC', location: 'Dallas', limit: 50 },
        reasoning: 'Finding prospects as directed by CEO',
      },
      'user-123',
      'tenant-456'
    );

    console.log(`CMO: Found ${cmoAction1.result?.data.prospects.length} prospects`);

    // CMO adds to pipeline
    const cmoAction2 = await executor.executePersonaAction(
      {
        personaId: 'cmo',
        tool: 'vpa_pipeline',
        action: 'import',
        parameters: { prospects: cmoAction1.result?.data.prospects },
        reasoning: 'Importing to CRM',
      },
      'user-123',
      'tenant-456'
    );

    console.log(`CMO: Added to pipeline, $${cmoAction2.result?.data.pipeline_value.toLocaleString()} value`);

    // CFO analyzes financials
    console.log(`CFO: "Based on 15% conversion rate, expect $${(cmoAction2.result?.data.pipeline_value * 0.15).toLocaleString()} revenue"`);

    // CEO concludes
    console.log('CEO: "Excellent. CMO launch the campaign, CFO prepare invoices"\n');

    // Verify meeting success
    expect(loggedActions).toHaveLength(2);
    expect(loggedActions[0].request.personaId).toBe('cmo');
    expect(loggedActions[1].request.personaId).toBe('cmo');
    expect(cmoAction1.status).toBe('completed');
    expect(cmoAction2.status).toBe('completed');
  });

  test('Action request parsing from LLM response', () => {
    // Simulate LLM response with action
    const llmResponse = `I'll search for HVAC companies in Dallas right now.

{
  "type": "action",
  "personaId": "ceo",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": {
    "industry": "HVAC",
    "location": "Dallas",
    "limit": 50
  },
  "reasoning": "User requested Dallas HVAC leads"
}

Once I have the results, I'll recommend next steps.`;

    const actionRequest = parseActionRequest(llmResponse);

    expect(actionRequest).not.toBeNull();
    expect(actionRequest?.personaId).toBe('ceo');
    expect(actionRequest?.tool).toBe('vpa_prospects');
    expect(actionRequest?.parameters.industry).toBe('HVAC');
    expect(actionRequest?.parameters.limit).toBe(50);
  });

  test('Tool-aware prompt includes tools', () => {
    const ceoTools = getPersonaTools('ceo');
    const formattedTools = formatToolsForPrompt(ceoTools);

    expect(formattedTools).toContain('Prospect Finder');
    expect(formattedTools).toContain('vpa_prospects');
    expect(formattedTools).toContain('search');
    expect(formattedTools).toContain('Example:');
  });
});

console.log('✅ All Integration tests defined');
