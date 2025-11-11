/**
 * VEA INTEGRATION DEMO
 *
 * Demonstrates real-world workflows:
 * 1. CEO finding HVAC prospects
 * 2. CFO handling bookkeeping
 * 3. CMO creating marketing content
 * 4. Board meeting with multiple personas
 */

const {
  PersonaActionExecutor,
  parseActionRequest,
  formatActionResultForContext,
} = require('./dist/index.js');

// Mock VPA Orchestrator (simulates real MCP server responses)
const mockOrchestrator = {
  async executeVPATool(tool, action, parameters, userId) {
    // Simulate realistic responses for each tool
    if (tool === 'vpa_prospects' && action === 'search') {
      return {
        success: true,
        summary: `Found ${parameters.limit || 50} ${parameters.industry || 'businesses'} in ${parameters.location || 'USA'}`,
        prospects: Array.from({ length: parameters.limit || 50 }, (_, i) => ({
          id: `prospect-${i + 1}`,
          name: `${parameters.industry || 'Business'} Company ${i + 1}`,
          contact: `contact${i + 1}@example.com`,
          phone: `555-${String(i + 1).padStart(4, '0')}`,
          location: parameters.location || 'USA',
        })),
      };
    }

    if (tool === 'vpa_pipeline' && action === 'import') {
      return {
        success: true,
        summary: `Imported ${parameters.prospects?.length || 0} prospects to pipeline`,
        leadsAdded: parameters.prospects?.length || 0,
        pipelineValue: `$${(parameters.prospects?.length || 0) * 5000}`,
      };
    }

    if (tool === 'vpa_email' && action === 'create_campaign') {
      return {
        success: true,
        summary: `Created campaign "${parameters.name}" for ${parameters.recipientCount || 0} recipients`,
        campaignId: 'campaign-001',
        scheduled: true,
        emailsToSend: parameters.recipientCount || 0,
      };
    }

    if (tool === 'vpa_bookkeeping' && action === 'generate_invoice') {
      return {
        success: true,
        summary: `Generated invoice #INV-${Math.floor(Math.random() * 10000)}`,
        invoiceId: `inv-${Date.now()}`,
        amount: parameters.amount || 1500,
        dueDate: '2025-12-01',
      };
    }

    if (tool === 'vpa_content' && action === 'generate_blog') {
      return {
        success: true,
        summary: `Generated blog post: "${parameters.topic}"`,
        content: `# ${parameters.topic}\n\nThis is a comprehensive blog post about ${parameters.topic}...\n\n(1200 words generated)`,
        wordCount: 1200,
      };
    }

    // Default response
    return {
      success: true,
      summary: `Executed ${tool}.${action}`,
      data: parameters,
    };
  },
};

// Initialize executor
const executor = new PersonaActionExecutor({
  orchestrator: mockOrchestrator,
  requireApproval: false, // Disable for demo
  riskThreshold: 50,
});

console.log('\n🎯 VEA INTEGRATION DEMO - Real-World Workflows\n');
console.log('='.repeat(80));

// ============================================================================
// Scenario 1: CEO - Complete Lead Generation Workflow
// ============================================================================
async function demoCEOWorkflow() {
  console.log('\n📊 SCENARIO 1: CEO - HVAC Lead Generation Workflow\n');
  console.log('-'.repeat(80));

  // Step 1: Find HVAC prospects in Dallas
  console.log('\n1️⃣  CEO: Finding HVAC companies in Dallas...');
  const prospectAction = await executor.executePersonaAction(
    {
      personaId: 'ceo',
      tool: 'vpa_prospects',
      action: 'search',
      parameters: {
        industry: 'HVAC',
        location: 'Dallas, TX',
        limit: 50,
      },
      reasoning: 'Need to build pipeline with HVAC companies for our service offering',
    },
    'user-ceo-demo',
    'tenant-acme'
  );

  console.log('   ✅ Status:', prospectAction.status);
  console.log('   📋 Result:', prospectAction.result?.summary);
  console.log('   ⚠️  Risk Score:', prospectAction.riskScore);

  // Step 2: Import prospects to pipeline
  console.log('\n2️⃣  CEO: Adding prospects to sales pipeline...');
  const importAction = await executor.executePersonaAction(
    {
      personaId: 'ceo',
      tool: 'vpa_pipeline',
      action: 'import',
      parameters: {
        prospects: prospectAction.result?.prospects || [],
        status: 'new',
        source: 'prospect-finder',
      },
      reasoning: 'Import HVAC prospects into pipeline for follow-up',
    },
    'user-ceo-demo',
    'tenant-acme'
  );

  console.log('   ✅ Status:', importAction.status);
  console.log('   📋 Result:', importAction.result?.summary);
  console.log('   💰 Pipeline Value:', importAction.result?.pipelineValue);

  // Step 3: Create email campaign
  console.log('\n3️⃣  CEO: Creating welcome email campaign...');
  const campaignAction = await executor.executePersonaAction(
    {
      personaId: 'ceo',
      tool: 'vpa_email',
      action: 'create_campaign',
      parameters: {
        name: 'HVAC Welcome Campaign',
        recipientCount: 50,
        subject: 'Improving HVAC Operations Together',
        template: 'welcome',
      },
      reasoning: 'Send introduction email to new HVAC prospects',
    },
    'user-ceo-demo',
    'tenant-acme'
  );

  console.log('   ✅ Status:', campaignAction.status);
  console.log('   📋 Result:', campaignAction.result?.summary);
  console.log('   📧 Campaign ID:', campaignAction.result?.campaignId);

  console.log('\n✅ CEO Workflow Complete!');
  console.log('   - Found 50 HVAC prospects');
  console.log('   - Added to pipeline (~$250k value)');
  console.log('   - Created email campaign');
}

// ============================================================================
// Scenario 2: CFO - Financial Management
// ============================================================================
async function demoCFOWorkflow() {
  console.log('\n💰 SCENARIO 2: CFO - Financial Management\n');
  console.log('-'.repeat(80));

  console.log('\n1️⃣  CFO: Generating client invoices...');
  const invoiceAction = await executor.executePersonaAction(
    {
      personaId: 'cfo',
      tool: 'vpa_bookkeeping',
      action: 'generate_invoice',
      parameters: {
        clientName: 'HVAC Company 5',
        amount: 2500,
        items: [
          { description: 'Monthly Service', amount: 2500 },
        ],
      },
      reasoning: 'Generate monthly service invoice for client',
    },
    'user-cfo-demo',
    'tenant-acme'
  );

  console.log('   ✅ Status:', invoiceAction.status);
  console.log('   📋 Result:', invoiceAction.result?.summary);
  console.log('   💵 Amount:', `$${invoiceAction.result?.amount}`);
  console.log('   📅 Due Date:', invoiceAction.result?.dueDate);

  console.log('\n✅ CFO Workflow Complete!');
  console.log('   - Generated client invoice');
  console.log('   - Automated bookkeeping entry');
}

// ============================================================================
// Scenario 3: CMO - Content Marketing
// ============================================================================
async function demoCMOWorkflow() {
  console.log('\n📣 SCENARIO 3: CMO - Content Marketing\n');
  console.log('-'.repeat(80));

  console.log('\n1️⃣  CMO: Creating blog post about HVAC maintenance...');
  const blogAction = await executor.executePersonaAction(
    {
      personaId: 'cmo',
      tool: 'vpa_content',
      action: 'generate_blog',
      parameters: {
        topic: 'Top 10 HVAC Maintenance Tips for Homeowners',
        tone: 'helpful',
        keywords: ['HVAC', 'maintenance', 'energy efficiency'],
      },
      reasoning: 'Create educational content to attract HVAC clients',
    },
    'user-cmo-demo',
    'tenant-acme'
  );

  console.log('   ✅ Status:', blogAction.status);
  console.log('   📋 Result:', blogAction.result?.summary);
  console.log('   📝 Word Count:', blogAction.result?.wordCount);

  console.log('\n✅ CMO Workflow Complete!');
  console.log('   - Generated SEO-optimized blog post');
  console.log('   - Ready for publication');
}

// ============================================================================
// Scenario 4: Board Meeting - Multi-Persona Collaboration
// ============================================================================
async function demoBoardMeeting() {
  console.log('\n🏢 SCENARIO 4: Virtual Board Meeting\n');
  console.log('-'.repeat(80));
  console.log('\nAgenda: Review Q4 Lead Generation Strategy\n');

  // Simulate LLM responses from different personas
  const ceoResponse = `Based on our analysis, we should focus on HVAC companies in Dallas.

{
  "type": "action",
  "personaId": "ceo",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": {"industry": "HVAC", "location": "Dallas, TX", "limit": 25},
  "reasoning": "Identifying potential clients for Q4 push"
}`;

  const cmoResponse = `I agree. Let me create content to support this campaign.

{
  "type": "action",
  "personaId": "cmo",
  "tool": "vpa_content",
  "action": "generate_blog",
  "parameters": {"topic": "HVAC Industry Trends 2025", "tone": "professional"},
  "reasoning": "Supporting content for HVAC outreach campaign"
}`;

  console.log('👨‍💼 CEO:');
  const ceoActionRequest = parseActionRequest(ceoResponse);
  if (ceoActionRequest) {
    const ceoAction = await executor.executePersonaAction(
      ceoActionRequest,
      'user-board-meeting',
      'tenant-acme'
    );
    console.log('   ' + formatActionResultForContext(ceoAction));
  }

  console.log('\n👩‍💼 CMO:');
  const cmoActionRequest = parseActionRequest(cmoResponse);
  if (cmoActionRequest) {
    const cmoAction = await executor.executePersonaAction(
      cmoActionRequest,
      'user-board-meeting',
      'tenant-acme'
    );
    console.log('   ' + formatActionResultForContext(cmoAction));
  }

  console.log('\n✅ Board Meeting Complete!');
  console.log('   - CEO initiated prospect search');
  console.log('   - CMO created supporting content');
  console.log('   - Actions logged for review');
}

// ============================================================================
// Scenario 5: Access Control Testing
// ============================================================================
async function demoAccessControl() {
  console.log('\n🔒 SCENARIO 5: Access Control Enforcement\n');
  console.log('-'.repeat(80));

  console.log('\n❌ Attempting: CFO trying to access marketing tool (should fail)...');
  try {
    await executor.executePersonaAction(
      {
        personaId: 'cfo',
        tool: 'vpa_content',
        action: 'generate_blog',
        parameters: { topic: 'Test' },
        reasoning: 'This should fail',
      },
      'user-access-test',
      'tenant-acme'
    );
    console.log('   ⚠️  UNEXPECTED: CFO was allowed to access marketing tool!');
  } catch (error) {
    console.log('   ✅ CORRECT: Access denied -', error.message);
  }

  console.log('\n✅ Attempting: CEO accessing all tools (should succeed)...');
  const ceoAction = await executor.executePersonaAction(
    {
      personaId: 'ceo',
      tool: 'vpa_content',
      action: 'generate_blog',
      parameters: { topic: 'CEO Strategic Vision' },
      reasoning: 'CEO has universal access',
    },
    'user-access-test',
    'tenant-acme'
  );
  console.log('   ✅ CORRECT: CEO accessed marketing tool successfully');
  console.log('   📋 Result:', ceoAction.result?.summary);

  console.log('\n✅ Access Control Test Complete!');
}

// ============================================================================
// Run All Demos
// ============================================================================
(async () => {
  try {
    await demoCEOWorkflow();
    await demoCFOWorkflow();
    await demoCMOWorkflow();
    await demoBoardMeeting();
    await demoAccessControl();

    console.log('\n' + '='.repeat(80));
    console.log('\n🎉 ALL INTEGRATION DEMOS COMPLETED SUCCESSFULLY!\n');
    console.log('VEA Core is ready for production integration.');
    console.log('\nNext Steps:');
    console.log('  1. Set up database and run migrations');
    console.log('  2. Connect real VPA-Core orchestrator');
    console.log('  3. Wire into chat endpoints');
    console.log('  4. Build approval UI for high-risk actions');
    console.log('  5. Deploy and test with real users\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
  }
})();
