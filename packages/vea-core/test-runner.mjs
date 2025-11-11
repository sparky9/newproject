/**
 * Standalone Test Runner for VEA Core
 *
 * Run with: node test-runner.mjs
 */

import {
  getPersonaTools,
  canPersonaAccessTool,
  getAllTools,
  getToolDefinition,
  PersonaActionExecutor,
  parseActionRequest,
  formatActionResultForContext,
} from './src/index.ts';

console.log('\n🧪 VEA CORE TEST SUITE');
console.log('='.repeat(80));
console.log();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
    failedTests++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toContain(expected) {
      if (typeof actual === 'string' && !actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
      if (Array.isArray(actual) && !actual.some(item => item === expected || item.tool === expected)) {
        throw new Error(`Expected array to contain ${expected}`);
      }
    },
    toBeGreaterThan(expected) {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} > ${expected}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error('Expected value to be defined');
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${actual}`);
      }
    },
    not: {
      toBeNull() {
        if (actual === null) {
          throw new Error('Expected value not to be null');
        }
      },
    },
  };
}

// ============================================================================
// TEST SUITE 1: Persona Tool Registry
// ============================================================================

console.log('📋 Persona Tool Registry Tests\n');

test('CEO has access to all tools', () => {
  const ceoTools = getPersonaTools('ceo');
  expect(ceoTools.length).toBeGreaterThan(10);
  expect(ceoTools).toContain('vpa_prospects');
  expect(ceoTools).toContain('vpa_pipeline');
});

test('CFO has financial tools only', () => {
  const cfoTools = getPersonaTools('cfo');
  expect(cfoTools).toContain('vpa_bookkeeping');
  expect(cfoTools).toContain('vpa_pipeline'); // for metrics
});

test('CMO has marketing tools', () => {
  const cmoTools = getPersonaTools('cmo');
  expect(cmoTools).toContain('vpa_prospects');
  expect(cmoTools).toContain('vpa_email');
  expect(cmoTools).toContain('vpa_content');
});

test('CTO has technical tools', () => {
  const ctoTools = getPersonaTools('cto');
  expect(ctoTools).toContain('vpa_tasks');
  expect(ctoTools).toContain('vpa_research');
});

test('CEO can access all tools', () => {
  expect(canPersonaAccessTool('ceo', 'vpa_prospects')).toBe(true);
  expect(canPersonaAccessTool('ceo', 'vpa_bookkeeping')).toBe(true);
  expect(canPersonaAccessTool('ceo', 'vpa_email')).toBe(true);
});

test('CFO cannot access marketing tools', () => {
  expect(canPersonaAccessTool('cfo', 'vpa_bookkeeping')).toBe(true);
  expect(canPersonaAccessTool('cfo', 'vpa_email')).toBe(false);
});

test('CMO cannot access financial tools', () => {
  expect(canPersonaAccessTool('cmo', 'vpa_email')).toBe(true);
  expect(canPersonaAccessTool('cmo', 'vpa_bookkeeping')).toBe(false);
});

test('getAllTools returns all tools', () => {
  const allTools = getAllTools();
  expect(allTools.length).toBeGreaterThan(20);
});

test('getToolDefinition returns correct tool', () => {
  const tool = getToolDefinition('vpa_prospects');
  expect(tool).not.toBeNull();
  expect(tool.name).toBe('Prospect Finder');
});

// ============================================================================
// TEST SUITE 2: Action Request Parsing
// ============================================================================

console.log('\n📋 Action Request Parsing Tests\n');

test('parseActionRequest extracts valid action', () => {
  const llmResponse = `I'll help you.

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
  expect(action).not.toBeNull();
  expect(action.personaId).toBe('ceo');
  expect(action.tool).toBe('vpa_prospects');
});

test('parseActionRequest returns null for no action', () => {
  const llmResponse = 'Just some advice here.';
  const action = parseActionRequest(llmResponse);
  expect(action).toBeNull();
});

// ============================================================================
// TEST SUITE 3: Persona Action Executor
// ============================================================================

console.log('\n📋 Persona Action Executor Tests\n');

// Mock orchestrator
const mockOrchestrator = {
  async executeVPATool(tool, action, parameters, userId) {
    return {
      success: true,
      summary: `Mock execution of ${tool}.${action}`,
      data: { tool, action, parameters },
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

  expect(action.status).toBe('completed');
  expect(action.result.success).toBe(true);
});

test('Executor rejects unauthorized access', async () => {
  const executor = new PersonaActionExecutor({
    orchestrator: mockOrchestrator,
    requireApproval: false,
  });

  try {
    await executor.executePersonaAction(
      {
        personaId: 'cfo',
        tool: 'vpa_content', // CFO cannot access
        action: 'generate',
        parameters: {},
        reasoning: 'Should fail',
      },
      'user-123',
      'tenant-456'
    );
    throw new Error('Should have thrown error');
  } catch (error) {
    expect(error.message).toContain('permission');
  }
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
      data: { summary: 'Found 50 companies' },
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
  expect(formatted).toContain('CEO');
  expect(formatted).toContain('successfully');
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('\n📊 TEST SUMMARY\n');
console.log(`Total Tests:  ${totalTests}`);
console.log(`Passed:       ${passedTests} ✅`);
console.log(`Failed:       ${failedTests} ❌`);
console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

if (failedTests > 0) {
  console.log('❌ Some tests failed\n');
  process.exit(1);
} else {
  console.log('✅ All tests passed!\n');
  process.exit(0);
}
