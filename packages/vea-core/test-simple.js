/**
 * Simple Standalone Test
 *
 * Tests VEA Core without any build dependencies
 */

// Import from compiled dist
const {
  getPersonaTools,
  canPersonaAccessTool,
  getAllTools,
  getToolDefinition,
  PersonaActionExecutor,
  parseActionRequest,
  formatActionResultForContext,
} = require('./dist/index.js');

console.log('\n🧪 VEA CORE - SIMPLE TEST\n');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ============================================================================
// Test Suite
// ============================================================================

console.log('\n📋 Testing Persona Tool Registry...\n');

test('CEO has access to multiple tools', () => {
  const ceoTools = getPersonaTools('ceo');
  assert(ceoTools.length > 10, `CEO should have > 10 tools, got ${ceoTools.length}`);
  assert(ceoTools.some(t => t.tool === 'vpa_prospects'), 'CEO should have vpa_prospects');
  assert(ceoTools.some(t => t.tool === 'vpa_pipeline'), 'CEO should have vpa_pipeline');
});

test('CFO has financial tools', () => {
  const cfoTools = getPersonaTools('cfo');
  assert(cfoTools.some(t => t.tool === 'vpa_bookkeeping'), 'CFO should have bookkeeping');
});

test('CMO has marketing tools', () => {
  const cmoTools = getPersonaTools('cmo');
  assert(cmoTools.some(t => t.tool === 'vpa_prospects'), 'CMO should have prospects');
  assert(cmoTools.some(t => t.tool === 'vpa_email'), 'CMO should have email');
});

test('CEO can access all tools', () => {
  assert(canPersonaAccessTool('ceo', 'vpa_prospects'), 'CEO should access prospects');
  assert(canPersonaAccessTool('ceo', 'vpa_email'), 'CEO should access email');
});

test('CFO cannot access marketing tools', () => {
  assert(canPersonaAccessTool('cfo', 'vpa_bookkeeping'), 'CFO should access bookkeeping');
  assert(!canPersonaAccessTool('cfo', 'vpa_email'), 'CFO should NOT access email');
});

test('getAllTools returns tools', () => {
  const allTools = getAllTools();
  assert(allTools.length >= 19, `Should have >= 19 tools, got ${allTools.length}`);
  assert(allTools.length > 15, `Should have > 15 tools, got ${allTools.length}`);
});

test('getToolDefinition works', () => {
  const tool = getToolDefinition('vpa_prospects');
  assert(tool !== undefined, 'Tool should be defined');
  assert(tool.name === 'Prospect Finder', 'Tool name should match');
});

console.log('\n📋 Testing Action Request Parsing...\n');

test('parseActionRequest extracts valid action', () => {
  const llmResponse = `I'll help.

{
  "type": "action",
  "personaId": "ceo",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": {"industry": "HVAC"},
  "reasoning": "Test"
}

Done.`;

  const action = parseActionRequest(llmResponse);
  assert(action !== null, 'Action should not be null');
  assert(action.personaId === 'ceo', 'PersonaId should be ceo');
  assert(action.tool === 'vpa_prospects', 'Tool should be vpa_prospects');
});

test('parseActionRequest returns null for no action', () => {
  const llmResponse = 'Just advice here.';
  const action = parseActionRequest(llmResponse);
  assert(action === null, 'Should return null for non-action response');
});

console.log('\n📋 Testing Persona Action Executor...\n');

// Mock orchestrator
const mockOrchestrator = {
  async executeVPATool(tool, action, parameters, userId) {
    return {
      success: true,
      summary: `Mock ${tool}.${action}`,
      data: { tool, action },
    };
  },
};

test('Executor executes valid action', async () => {
  const executor = new PersonaActionExecutor({
    orchestrator: mockOrchestrator,
    requireApproval: false,
  });

  const action = await executor.executePersonaAction(
    {
      personaId: 'ceo',
      tool: 'vpa_prospects',
      action: 'search',
      parameters: { industry: 'HVAC' },
      reasoning: 'Test',
    },
    'user-123',
    'tenant-456'
  );

  assert(action.status === 'completed', `Status should be completed, got ${action.status}`);
  assert(action.result.success === true, 'Result should be successful');
});

test('Executor rejects unauthorized access', async () => {
  const executor = new PersonaActionExecutor({
    orchestrator: mockOrchestrator,
    requireApproval: false,
  });

  let errorThrown = false;
  try {
    await executor.executePersonaAction(
      {
        personaId: 'cfo',
        tool: 'vpa_content',
        action: 'generate',
        parameters: {},
        reasoning: 'Should fail',
      },
      'user-123',
      'tenant-456'
    );
  } catch (error) {
    errorThrown = true;
    assert(error.message.includes('permission'), 'Error should mention permission');
  }

  assert(errorThrown, 'Should throw error for unauthorized access');
});

test('formatActionResultForContext formats correctly', () => {
  const action = {
    request: {
      personaId: 'ceo',
      tool: 'vpa_prospects',
      action: 'search',
      parameters: {},
      reasoning: 'Test',
    },
    result: {
      success: true,
      data: { summary: 'Found 50' },
      metadata: {
        executionTime: 500,
        timestamp: new Date(),
        module: 'prospect-finder',
      },
    },
    status: 'completed',
    requiresApproval: false,
    riskScore: 10,
  };

  const formatted = formatActionResultForContext(action);
  assert(formatted.includes('CEO'), 'Should include CEO');
  assert(formatted.includes('successfully'), 'Should include successfully');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log(`\n📊 TEST RESULTS\n`);
console.log(`Total:   ${passed + failed}`);
console.log(`Passed:  ${passed} ✅`);
console.log(`Failed:  ${failed} ❌`);
console.log(`Success: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

if (failed > 0) {
  console.log('❌ Some tests failed\n');
  process.exit(1);
} else {
  console.log('✅ All tests passed!\n');
  process.exit(0);
}
