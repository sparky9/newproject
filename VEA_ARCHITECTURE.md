# VEA (Virtual Executive Assistant) Architecture

## Vision
Enable C-suite AI personas (CEO, CFO, CMO, CTO) to actually USE the 16 MCP modules to execute tasks, not just provide advice.

## Current State Analysis

### What Exists:

1. **Online C Suite Platform** (`/tmp/csuite/apps/`)
   - C-suite personas (CEO, CFO, CMO, CTO) with distinct personalities
   - Board meeting orchestration system
   - Prompt builder that creates context-aware persona responses
   - Chat interface and conversation management
   - Multi-tenant SaaS infrastructure

2. **VPA-Core Module Orchestrator** (`/tmp/csuite/lead-gen-app/vpa-core/`)
   - Intent parser (keyword + LLM fallback)
   - Module registry with 16 modules
   - Tool execution framework
   - License validation & access control
   - Usage tracking

3. **16 MCP Modules** (`/tmp/csuite/lead-gen-app/*/`)
   - ProspectFinder, LeadTracker Pro, Email Orchestrator
   - Bookkeeping, Calendar, Tasks, Content Writer
   - Support Agent, Onboarding, Retention, etc.
   - Each with 5-15 specialized tools

### The Gap:
**C-suite personas and VPA modules are DISCONNECTED**
- Personas generate advice via LLM prompts
- Modules execute actions via MCP tools
- No bridge between them

## Proposed Architecture

### Layer 1: Persona Tool Registry
**Purpose:** Define which tools each persona can access

```typescript
// New file: packages/vea-core/src/persona-tools.ts

interface PersonaToolAccess {
  personaId: 'ceo' | 'cfo' | 'cmo' | 'cto';
  allowedModules: string[];
  preferredTools: ToolDefinition[];
}

const PERSONA_TOOL_REGISTRY: PersonaToolAccess[] = [
  {
    personaId: 'ceo',
    allowedModules: ['*'], // CEO has access to everything
    preferredTools: [
      // Strategic tools
      'vpa_metrics_dashboard',
      'vpa_research',
      'vpa_tasks',
      'vpa_status'
    ]
  },
  {
    personaId: 'cfo',
    allowedModules: [
      'bookkeeping-assistant',
      'time-billing-agent',
      'leadtracker-pro', // for revenue metrics
      'prospect-finder' // for pipeline value
    ],
    preferredTools: [
      'generate_invoice',
      'generate_report',
      'track_expense',
      'calculate_tax',
      'get_pipeline_stats'
    ]
  },
  {
    personaId: 'cmo',
    allowedModules: [
      'prospect-finder',
      'email-orchestrator',
      'content-writer',
      'social-media-manager',
      'leadtracker-pro'
    ],
    preferredTools: [
      'search_companies',
      'create_campaign',
      'generate_blog',
      'generate_social',
      'get_pipeline_stats'
    ]
  },
  {
    personaId: 'cto',
    allowedModules: [
      'task-project-manager',
      'research-insights',
      'image-studio-mcp'
    ],
    preferredTools: [
      'add_task',
      'get_next_actions',
      'add_source',
      'generate_image'
    ]
  }
];
```

### Layer 2: Persona Action Executor
**Purpose:** Bridge between LLM persona responses and VPA tool execution

```typescript
// New file: packages/vea-core/src/persona-executor.ts

interface PersonaAction {
  personaId: 'ceo' | 'cfo' | 'cmo' | 'cto';
  tool: string;
  action: string;
  parameters: Record<string, any>;
  reasoning: string; // Why the persona chose this action
}

class PersonaActionExecutor {
  /**
   * Persona requests to execute a tool
   * Validates access, executes via VPA orchestrator, returns result
   */
  async executePersonaAction(
    action: PersonaAction,
    userId: string,
    tenantId: string
  ): Promise<ExecutionResult> {
    // 1. Validate persona has access to this tool
    const hasAccess = await validatePersonaToolAccess(
      action.personaId,
      action.tool
    );

    if (!hasAccess) {
      throw new PersonaAccessDeniedError(
        `${action.personaId} cannot access ${action.tool}`
      );
    }

    // 2. Execute via VPA orchestrator
    const result = await executeVPATool(
      action.tool,
      action.action,
      action.parameters,
      userId
    );

    // 3. Log persona action for board meeting context
    await logPersonaAction({
      personaId: action.personaId,
      userId,
      tenantId,
      tool: action.tool,
      action: action.action,
      parameters: action.parameters,
      result,
      reasoning: action.reasoning,
      timestamp: new Date()
    });

    return result;
  }
}
```

### Layer 3: Enhanced Prompt Builder with Tool Awareness
**Purpose:** Teach personas ABOUT the tools they can use

```typescript
// Enhanced: apps/api/src/services/llm/prompt-builder.ts

export async function buildCEOPromptWithTools(
  userMessage: string,
  context: PromptContext
): Promise<LLMMessage[]> {
  const messages: LLMMessage[] = [];

  // Get available tools for this persona
  const availableTools = getPersonaTools('ceo', context.tenantId);

  // Enhanced system prompt that includes tool awareness
  const systemPrompt = `You are the CEO of ${context.businessProfile?.industry || 'this company'}.

Your role is to provide strategic guidance and TAKE ACTION when needed.

YOU HAVE ACCESS TO THESE TOOLS:
${formatToolsForPrompt(availableTools)}

When the user asks you to do something, you can:
1. Provide strategic advice (your default mode)
2. EXECUTE actions using your available tools
3. Coordinate with other executives (CFO, CMO, CTO) to use their tools

IMPORTANT: When you want to execute a tool, respond with a structured action request:
{
  "type": "action",
  "personaId": "ceo",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": { "industry": "HVAC", "location": "Dallas", "limit": 50 },
  "reasoning": "Finding HVAC companies as requested by user"
}

Otherwise, respond naturally with strategic guidance.

Current business context:
${formatBusinessContext(context)}

Recent insights:
${formatRecentInsights(context.recentInsights)}
`;

  messages.push({ role: 'system', content: systemPrompt });

  // ... rest of prompt building

  return messages;
}
```

### Layer 4: Board Meeting with Tool Execution
**Purpose:** Enable multi-persona coordination with tool usage

```typescript
// Enhanced: apps/api/src/services/board-meeting.ts

interface BoardMeetingWithActions extends BoardMeetingContext {
  executedActions: PersonaAction[];
  pendingActions: PersonaAction[];
}

export async function orchestrateBoardMeetingWithTools(
  agenda: AgendaTemplateItem[],
  context: BoardMeetingContext,
  tenantId: string,
  userId: string
): Promise<BoardMeetingWithActions> {

  const executedActions: PersonaAction[] = [];
  const pendingActions: PersonaAction[] = [];

  // For each agenda item
  for (const agendaItem of agenda) {
    const persona = agendaItem.personaId;

    // Get persona's response
    const response = await getPersonaResponse(persona, agendaItem, context);

    // Check if persona wants to execute a tool
    const actionRequest = parseActionRequest(response);

    if (actionRequest) {
      // Persona wants to take action!
      try {
        const result = await personaExecutor.executePersonaAction(
          actionRequest,
          userId,
          tenantId
        );

        executedActions.push({
          ...actionRequest,
          result
        });

        // Update context with action result for subsequent personas
        context = await enrichContextWithActionResult(context, result);

      } catch (error) {
        // Action failed, add to pending
        pendingActions.push({
          ...actionRequest,
          error: error.message
        });
      }
    }

    // Store persona turn with executed actions
    await storePersonaTurn({
      meetingId: context.meetingId,
      personaId: persona,
      response,
      executedActions: actionRequest ? [actionRequest] : []
    });
  }

  return {
    ...context,
    executedActions,
    pendingActions
  };
}
```

### Layer 5: VEA Unified Interface
**Purpose:** Single dashboard showing personas + modules

```
VEA Dashboard Layout:
┌─────────────────────────────────────────────────┐
│  VEA - Virtual Executive Assistant              │
├─────────────────────────────────────────────────┤
│                                                  │
│  [Board Room]  [Modules]  [Workflows]  [Admin]  │
│                                                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  BOARD ROOM                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │   CEO    │  │   CFO    │  │   CMO    │      │
│  │  Online  │  │  Online  │  │  Online  │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                  │
│  Recent Actions:                                │
│  • CEO: Found 50 HVAC companies in Dallas       │
│  • CMO: Created email campaign "HVAC Outreach"  │
│  • CFO: Generated 12 invoices ($45,000)         │
│                                                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  MODULES (16 available)                         │
│  📊 ProspectFinder    📧 Email Orchestrator     │
│  💼 LeadTracker Pro   📝 Content Writer         │
│  💰 Bookkeeping       📅 Calendar Agent         │
│  ... (show all 16)                              │
│                                                  │
└─────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Foundation (Week 1)
- [ ] Create `packages/vea-core/` - New package for VEA logic
- [ ] Implement `persona-tools.ts` - Tool registry per persona
- [ ] Implement `persona-executor.ts` - Action execution bridge
- [ ] Add database tables for persona actions logging

### Phase 2: Persona Enhancement (Week 2)
- [ ] Enhance prompt builder with tool awareness
- [ ] Add action request parsing logic
- [ ] Implement tool result formatting for personas
- [ ] Test single persona tool execution

### Phase 3: Board Meeting Integration (Week 3)
- [ ] Enhance board meeting orchestrator with tool execution
- [ ] Add multi-persona coordination logic
- [ ] Implement context sharing between personas
- [ ] Test board meeting workflows

### Phase 4: VEA UI (Week 4)
- [ ] Create VEA dashboard layout
- [ ] Build board room interface
- [ ] Add module dashboards
- [ ] Implement real-time action streaming

### Phase 5: Workflows (Week 5)
- [ ] Build workflow engine (chain multiple persona actions)
- [ ] Add workflow templates
- [ ] Implement approval system for sensitive actions
- [ ] Create workflow monitoring

### Phase 6: Polish & Testing (Week 6)
- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] Documentation
- [ ] Demo workflows

## Key Technical Decisions

### 1. Tool Access Control
- Each persona has defined tool access (security)
- CEO has broadest access (coordinator role)
- CFO limited to financial tools
- CMO limited to marketing tools
- CTO limited to technical/project tools

### 2. Action Request Format
Personas signal tool usage via structured JSON in their response:
```json
{
  "type": "action",
  "personaId": "cmo",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": { "industry": "HVAC", "location": "Dallas" },
  "reasoning": "Finding leads as discussed"
}
```

### 3. Board Meeting Coordination
- Personas can see previous persona actions in the same meeting
- Actions executed sequentially (dependency resolution)
- Failed actions captured and presented to user for retry

### 4. Approval System
- High-risk actions (delete, payment, bulk operations) require user approval
- Low-risk actions (search, read, generate) execute immediately
- Risk scores calculated per tool + parameters

## Success Metrics

1. **Persona Tool Usage Rate**
   - % of persona responses that include tool execution
   - Target: 40% of interactions include at least 1 tool call

2. **Cross-Module Workflows**
   - # of board meetings where 2+ modules are used
   - Target: 60% of board meetings are multi-module

3. **User Satisfaction**
   - "The personas actually DO things" - measured via feedback
   - Target: 4.5+ / 5 stars

4. **Automation ROI**
   - Hours saved per week via persona automation
   - Target: 10+ hours/week for average user

## Next Steps

1. Review this architecture
2. Prioritize what to build first
3. Set up `packages/vea-core/` structure
4. Begin Phase 1 implementation
