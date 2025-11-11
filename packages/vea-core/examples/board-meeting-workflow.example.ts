/**
 * Example: Board Meeting with Multi-Persona Tool Execution
 *
 * Demonstrates a complete workflow where:
 * 1. User requests leads
 * 2. CMO finds prospects → adds to pipeline → creates email campaign
 * 3. CFO analyzes pipeline value
 * 4. CEO approves and coordinates
 *
 * This shows the power of personas working together!
 */

import {
  PersonaActionExecutor,
  type PersonaActionRequest,
  type BoardMeetingContext,
  type VPAOrchestrator,
} from '../src/index.js';

// ============================================================================
// Mock Orchestrator with Multiple Module Support
// ============================================================================

const mockOrchestrator: VPAOrchestrator = {
  async executeVPATool(tool, action, parameters, userId) {
    console.log(`  🔧 [${tool}] ${action}`);

    // Simulate different module responses
    switch (tool) {
      case 'vpa_prospects':
        if (action === 'search') {
          return {
            success: true,
            summary: `Found 50 HVAC companies in Dallas`,
            prospects: Array.from({ length: 50 }, (_, i) => ({
              id: `prospect-${i + 1}`,
              name: `Dallas HVAC Co ${i + 1}`,
              phone: `214-555-${1000 + i}`,
              email: `contact@hvac${i + 1}.com`,
            })),
          };
        }
        break;

      case 'vpa_pipeline':
        if (action === 'import') {
          return {
            success: true,
            summary: `Added ${parameters.prospects.length} prospects to pipeline`,
            imported: parameters.prospects.length,
            total_pipeline_value: parameters.prospects.length * 5000, // $5k per lead
          };
        } else if (action === 'get_stats') {
          return {
            success: true,
            total_leads: 150,
            new_leads: 50,
            pipeline_value: 250000,
            conversion_rate: 15,
          };
        }
        break;

      case 'vpa_email':
        if (action === 'create_campaign') {
          return {
            success: true,
            campaign_id: 'camp-123',
            name: parameters.name,
            audience_size: parameters.audience_size || 50,
            status: 'draft',
          };
        }
        break;

      case 'vpa_bookkeeping':
        if (action === 'forecast_cash_flow') {
          return {
            success: true,
            forecast_30_days: 125000,
            forecast_60_days: 220000,
            forecast_90_days: 380000,
          };
        }
        break;
    }

    return { success: true, message: 'Action completed' };
  },
};

// ============================================================================
// Simulate Board Meeting with Tool Execution
// ============================================================================

async function simulateBoardMeeting() {
  console.log('\n' + '='.repeat(80));
  console.log('📋 BOARD MEETING: Q1 Growth Strategy');
  console.log('='.repeat(80));
  console.log('\n[USER]: "We need to expand into the Dallas HVAC market ASAP"\n');

  const executor = new PersonaActionExecutor({
    orchestrator: mockOrchestrator,
    requireApproval: false,
    riskThreshold: 50,
  });

  const userId = 'user-123';
  const tenantId = 'tenant-456';

  const context: BoardMeetingContext = {
    meetingId: 'meeting-001',
    tenantId,
    userId,
    executedActions: [],
    pendingActions: [],
    sharedInsights: [],
  };

  // =========================================================================
  // TURN 1: CEO Opens Discussion
  // =========================================================================

  console.log('─'.repeat(80));
  console.log('💼 CEO: Strategic Overview');
  console.log('─'.repeat(80));
  console.log(
    `"Dallas is a $50M market opportunity for HVAC services. Let's coordinate:`
  );
  console.log('1. CMO: Find qualified leads');
  console.log('2. CMO: Set up outreach campaign');
  console.log('3. CFO: Analyze financial impact');
  console.log('Let\'s execute."\n');

  // =========================================================================
  // TURN 2: CMO Executes Prospect Finding
  // =========================================================================

  console.log('─'.repeat(80));
  console.log('📈 CMO: Lead Generation');
  console.log('─'.repeat(80));
  console.log('"I\'ll search our database for HVAC companies in Dallas..."\n');

  const cmoAction1: PersonaActionRequest = {
    personaId: 'cmo',
    tool: 'vpa_prospects',
    action: 'search',
    parameters: {
      industry: 'HVAC',
      location: 'Dallas',
      limit: 50,
    },
    reasoning: 'Finding target prospects in Dallas HVAC market',
  };

  const action1 = await executor.executePersonaAction(cmoAction1, userId, tenantId);
  context.executedActions.push(action1);

  console.log(`✅ Found ${action1.result?.data.prospects.length} prospects`);
  console.log(`⏱️  Completed in ${action1.result?.metadata.executionTime}ms\n`);

  // =========================================================================
  // TURN 3: CMO Adds to Pipeline
  // =========================================================================

  console.log('"Now adding these prospects to our CRM pipeline..."\n');

  const cmoAction2: PersonaActionRequest = {
    personaId: 'cmo',
    tool: 'vpa_pipeline',
    action: 'import',
    parameters: {
      prospects: action1.result?.data.prospects || [],
      status: 'new',
      source: 'Dallas HVAC search',
    },
    reasoning: 'Importing prospects into LeadTracker Pro for management',
  };

  const action2 = await executor.executePersonaAction(cmoAction2, userId, tenantId);
  context.executedActions.push(action2);

  console.log(`✅ Added ${action2.result?.data.imported} leads to pipeline`);
  console.log(`💰 Total pipeline value: $${action2.result?.data.total_pipeline_value.toLocaleString()}`);
  console.log(`⏱️  Completed in ${action2.result?.metadata.executionTime}ms\n`);

  // =========================================================================
  // TURN 4: CMO Creates Email Campaign
  // =========================================================================

  console.log('"Creating a welcome email campaign for these prospects..."\n');

  const cmoAction3: PersonaActionRequest = {
    personaId: 'cmo',
    tool: 'vpa_email',
    action: 'create_campaign',
    parameters: {
      name: 'Dallas HVAC Welcome',
      subject: 'Exclusive HVAC Service Offer for Dallas Businesses',
      audience_size: 50,
      template: 'b2b_intro',
    },
    reasoning: 'Initial outreach campaign for new Dallas leads',
  };

  const action3 = await executor.executePersonaAction(cmoAction3, userId, tenantId);
  context.executedActions.push(action3);

  console.log(`✅ Campaign "${action3.result?.data.name}" created`);
  console.log(`📧 Audience: ${action3.result?.data.audience_size} recipients`);
  console.log(`⏱️  Completed in ${action3.result?.metadata.executionTime}ms\n`);

  // =========================================================================
  // TURN 5: CFO Analyzes Financial Impact
  // =========================================================================

  console.log('─'.repeat(80));
  console.log('💵 CFO: Financial Analysis');
  console.log('─'.repeat(80));
  console.log(
    '"Let me pull our current pipeline stats and forecast the revenue impact..."\n'
  );

  const cfoAction1: PersonaActionRequest = {
    personaId: 'cfo',
    tool: 'vpa_pipeline',
    action: 'get_stats',
    parameters: {},
    reasoning: 'Analyzing pipeline value and conversion rates',
  };

  const action4 = await executor.executePersonaAction(cfoAction1, userId, tenantId);
  context.executedActions.push(action4);

  const stats = action4.result?.data;
  console.log(`✅ Pipeline Analysis:`);
  console.log(`   Total leads: ${stats.total_leads}`);
  console.log(`   New leads: ${stats.new_leads}`);
  console.log(`   Pipeline value: $${stats.pipeline_value.toLocaleString()}`);
  console.log(`   Conversion rate: ${stats.conversion_rate}%`);
  console.log(`⏱️  Completed in ${action4.result?.metadata.executionTime}ms\n`);

  console.log('"Based on our 15% conversion rate, we should expect:');
  console.log(
    `- 7-8 closed deals from this batch ($${(250000 * 0.15).toLocaleString()} in revenue)`
  );
  console.log(`- ROI positive within 60 days"\n`);

  // =========================================================================
  // TURN 6: CEO Summary & Approval
  // =========================================================================

  console.log('─'.repeat(80));
  console.log('💼 CEO: Decision & Next Steps');
  console.log('─'.repeat(80));
  console.log('"Excellent execution team! Here\'s what we\'ve accomplished:\n');

  console.log('✅ Actions Completed:');
  context.executedActions.forEach((action, i) => {
    console.log(
      `   ${i + 1}. ${action.request.personaId.toUpperCase()}: ${action.request.tool}.${action.request.action}`
    );
  });

  console.log('\n📊 Results:');
  console.log('   - 50 new HVAC prospects identified');
  console.log('   - All imported to CRM pipeline');
  console.log('   - Welcome campaign ready to launch');
  console.log('   - Projected revenue: $37,500 in 60 days');

  console.log('\n🚀 Next Steps:');
  console.log('   1. CMO: Launch email campaign Monday 9am');
  console.log('   2. Sales: Begin calling top 10 qualified leads');
  console.log('   3. CFO: Monitor cash flow for Q1 hiring');
  console.log('   4. CTO: Set up campaign tracking dashboard"\n');

  // =========================================================================
  // Summary
  // =========================================================================

  console.log('='.repeat(80));
  console.log('📈 MEETING SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total actions executed: ${context.executedActions.length}`);
  console.log(
    `Total execution time: ${context.executedActions.reduce((sum, a) => sum + (a.result?.metadata.executionTime || 0), 0)}ms`
  );
  console.log(`Success rate: ${context.executedActions.filter(a => a.status === 'completed').length}/${context.executedActions.length}`);
  console.log('\nPersona participation:');
  console.log(`  CMO: 3 actions (lead gen, pipeline, email)`);
  console.log(`  CFO: 1 action (financial analysis)`);
  console.log(`  CEO: 0 actions (coordination only)`);
  console.log('\n' + '='.repeat(80) + '\n');
}

// Run the example
simulateBoardMeeting().catch(console.error);
