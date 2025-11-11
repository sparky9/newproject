/**
 * Example: CEO using ProspectFinder to find HVAC leads
 *
 * This demonstrates the complete flow:
 * 1. User asks CEO for leads
 * 2. CEO's prompt includes tool awareness
 * 3. CEO responds with action request
 * 4. System parses and executes the action
 * 5. Result is returned to user
 */

import {
  PersonaActionExecutor,
  getPersonaTools,
  formatToolsForPrompt,
  parseActionRequest,
  formatActionResultForContext,
  type VPAOrchestrator,
  type PersonaActionLogger,
} from '../src/index.js';

// ============================================================================
// STEP 1: Mock VPA Orchestrator (in real integration, this calls VPA-Core)
// ============================================================================

const mockOrchestrator: VPAOrchestrator = {
  async executeVPATool(tool, action, parameters, userId) {
    console.log(`[VPA Orchestrator] Executing ${tool}.${action} for ${userId}`);
    console.log('[VPA Orchestrator] Parameters:', JSON.stringify(parameters, null, 2));

    // Simulate ProspectFinder tool execution
    if (tool === 'vpa_prospects' && action === 'search') {
      return {
        success: true,
        summary: `Found ${parameters.limit} ${parameters.industry} companies in ${parameters.location}`,
        prospects: Array.from({ length: parameters.limit }, (_, i) => ({
          id: `prospect-${i + 1}`,
          name: `${parameters.industry} Company ${i + 1}`,
          industry: parameters.industry,
          location: parameters.location,
          phone: `555-${1000 + i}`,
          website: `https://company${i + 1}.com`,
        })),
      };
    }

    throw new Error(`Unknown tool: ${tool}.${action}`);
  },
};

// ============================================================================
// STEP 2: Mock Action Logger (in real integration, this saves to database)
// ============================================================================

const mockLogger: PersonaActionLogger = {
  async logAction(action, userId, tenantId) {
    console.log(`[Action Logger] Logging action for ${userId}@${tenantId}`);
    console.log('[Action Logger] Action:', {
      persona: action.request.personaId,
      tool: action.request.tool,
      action: action.request.action,
      status: action.status,
      riskScore: action.riskScore,
    });
  },
};

// ============================================================================
// STEP 3: Build CEO Prompt with Tool Awareness
// ============================================================================

function buildCEOPrompt(userMessage: string): string {
  const ceoTools = getPersonaTools('ceo');

  const systemPrompt = `You are the CEO of this company.

Your role is to provide strategic guidance and TAKE ACTION when needed.

YOU HAVE ACCESS TO THESE TOOLS:
${formatToolsForPrompt(ceoTools)}

IMPORTANT: When you want to execute a tool, respond with JSON:
{
  "type": "action",
  "personaId": "ceo",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": { "industry": "HVAC", "location": "Dallas", "limit": 50 },
  "reasoning": "Finding HVAC companies as requested by user"
}

Otherwise, respond naturally with strategic guidance.

USER MESSAGE: ${userMessage}

YOUR RESPONSE:`;

  return systemPrompt;
}

// ============================================================================
// STEP 4: Simulate CEO's LLM Response
// ============================================================================

function simulateCEOResponse(prompt: string): string {
  // In real implementation, this would call Fireworks AI
  // For this example, we'll simulate the CEO choosing to use ProspectFinder

  return `I'll help you find HVAC leads in Dallas right away. Let me search our database.

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
  "reasoning": "User requested HVAC leads in Dallas, using ProspectFinder to search our database",
  "expectedOutcome": "List of 50 HVAC companies with contact information"
}

Once I have the results, I'll recommend next steps for outreach.`;
}

// ============================================================================
// STEP 5: Execute the Complete Flow
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('Example: CEO Using ProspectFinder');
  console.log('='.repeat(80));
  console.log();

  // User's request
  const userMessage = 'I need to find 50 HVAC companies in Dallas';
  console.log('[User]:', userMessage);
  console.log();

  // Build prompt
  console.log('[System] Building CEO prompt with tool awareness...');
  const prompt = buildCEOPrompt(userMessage);
  console.log();

  // Get CEO response (simulated LLM call)
  console.log('[System] Getting CEO response...');
  const ceoResponse = simulateCEOResponse(prompt);
  console.log('[CEO Response]:', ceoResponse);
  console.log();

  // Parse action request
  console.log('[System] Parsing action request...');
  const actionRequest = parseActionRequest(ceoResponse);

  if (!actionRequest) {
    console.log('[System] No action requested, returning response to user');
    return;
  }

  console.log('[System] Action request detected:');
  console.log('  Persona:', actionRequest.personaId);
  console.log('  Tool:', actionRequest.tool);
  console.log('  Action:', actionRequest.action);
  console.log('  Reasoning:', actionRequest.reasoning);
  console.log();

  // Create executor
  console.log('[System] Creating PersonaActionExecutor...');
  const executor = new PersonaActionExecutor({
    orchestrator: mockOrchestrator,
    logger: mockLogger,
    requireApproval: false, // Disable for this example
    riskThreshold: 50,
  });
  console.log();

  // Execute the action
  console.log('[System] Executing persona action...');
  const action = await executor.executePersonaAction(
    actionRequest,
    'example-user-123',
    'example-tenant-456'
  );
  console.log();

  // Show results
  console.log('[System] Action execution complete!');
  console.log('  Status:', action.status);
  console.log('  Risk Score:', action.riskScore);
  console.log('  Execution Time:', action.result?.metadata.executionTime + 'ms');
  console.log();

  if (action.result?.success) {
    console.log('[Result]:', action.result.data.summary);
    console.log('[Prospects Found]:', action.result.data.prospects.length);
    console.log();
    console.log('Sample prospects:');
    action.result.data.prospects.slice(0, 3).forEach((p: any) => {
      console.log(`  - ${p.name} (${p.phone}) - ${p.website}`);
    });
    console.log();
  }

  // Format for context sharing (useful in board meetings)
  const contextSummary = formatActionResultForContext(action);
  console.log('[Context Summary]:', contextSummary);
  console.log();

  console.log('='.repeat(80));
  console.log('Example Complete!');
  console.log('='.repeat(80));
}

// Run the example
main().catch(console.error);
