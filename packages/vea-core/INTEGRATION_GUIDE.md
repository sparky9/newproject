# VEA Core Integration Guide

This guide shows how to integrate `@vea/core` with Online C Suite and VPA-Core.

## Architecture Overview

```
┌─────────────────────────────────────────┐
│  Online C Suite (apps/api)              │
│  - Prompt Builder (LLM prompts)         │
│  - Board Meeting Orchestrator           │
│  - Chat Routes                          │
└──────────────┬──────────────────────────┘
               │
               │ Uses @vea/core to:
               │ - Get available tools
               │ - Parse action requests
               │ - Format results
               │
               ↓
┌─────────────────────────────────────────┐
│  @vea/core (THIS PACKAGE)                │
│  - Persona Tool Registry                 │
│  - Persona Action Executor               │
│  - Access Control                        │
└──────────────┬──────────────────────────┘
               │
               │ Calls VPA orchestrator
               │
               ↓
┌─────────────────────────────────────────┐
│  VPA Core (lead-gen-app/vpa-core)       │
│  - executeVPATool()                     │
│  - Module routing                       │
│  - Usage tracking                       │
└──────────────┬──────────────────────────┘
               │
               │ Executes tools
               │
               ↓
┌─────────────────────────────────────────┐
│  16 MCP Modules                         │
│  - ProspectFinder                       │
│  - LeadTracker Pro                      │
│  - Email Orchestrator                   │
│  - Bookkeeping, Calendar, etc.          │
└─────────────────────────────────────────┘
```

## Step 1: Install in Online C Suite

Add to `/tmp/csuite/package.json`:

```json
{
  "dependencies": {
    "@vea/core": "workspace:*"
  }
}
```

Run `pnpm install` in the csuite root.

## Step 2: Enhance Prompt Builder

Update `/tmp/csuite/apps/api/src/services/llm/prompt-builder.ts`:

```typescript
import {
  getPersonaTools,
  formatToolsForPrompt,
  type PersonaId,
} from '@vea/core';

export async function buildCEOPromptWithTools(
  userMessage: string,
  context: PromptContext
): Promise<LLMMessage[]> {
  const messages: LLMMessage[] = [];

  // Get available tools for CEO
  const availableTools = getPersonaTools('ceo');

  // Enhanced system prompt
  const systemPrompt = `You are the CEO of ${context.businessProfile?.industry || 'this company'}.

Your role is to provide strategic guidance and TAKE ACTION when needed.

YOU HAVE ACCESS TO THESE TOOLS:
${formatToolsForPrompt(availableTools)}

IMPORTANT: When you want to execute a tool, respond with:
{
  "type": "action",
  "personaId": "ceo",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": { "industry": "HVAC", "location": "Dallas", "limit": 50 },
  "reasoning": "Finding HVAC companies as requested"
}

Otherwise, respond naturally with strategic guidance.

Current context:
${formatBusinessContext(context)}
`;

  messages.push({ role: 'system', content: systemPrompt });

  // Add conversation history
  if (context.conversationId) {
    const history = await loadConversationHistory(context.conversationId);
    messages.push(...history);
  }

  // Add user message
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

// Similar for CFO, CMO, CTO
export async function buildCFOPromptWithTools(...) { ... }
export async function buildCMOPromptWithTools(...) { ... }
export async function buildCTOPromptWithTools(...) { ... }
```

## Step 3: Create VPA Orchestrator Adapter

Create `/tmp/csuite/apps/api/src/services/vpa-orchestrator-adapter.ts`:

```typescript
import { executeVPATool } from '../../../../lead-gen-app/vpa-core/src/orchestrator.js';
import type { VPAOrchestrator } from '@vea/core';

/**
 * Adapter that bridges @vea/core to VPA-Core orchestrator
 */
export const vpaOrchestratorAdapter: VPAOrchestrator = {
  async executeVPATool(
    tool: string,
    action: string,
    parameters: any,
    userId: string
  ): Promise<any> {
    // Call the actual VPA orchestrator
    return await executeVPATool(tool, action, parameters, userId);
  },
};
```

## Step 4: Create Action Logger

Create `/tmp/csuite/apps/api/src/services/persona-action-logger.ts`:

```typescript
import { prisma, createTenantClient } from '@ocsuite/db';
import type { PersonaActionLogger, PersonaAction } from '@vea/core';

/**
 * Logs persona actions to database for audit and board context
 */
export const personaActionLogger: PersonaActionLogger = {
  async logAction(
    action: PersonaAction,
    userId: string,
    tenantId: string
  ): Promise<void> {
    const db = createTenantClient({ tenantId, userId });

    // TODO: Create persona_actions table in Prisma schema
    await db.personaAction.create({
      data: {
        tenantId,
        userId,
        personaId: action.request.personaId,
        tool: action.request.tool,
        action: action.request.action,
        parameters: action.request.parameters,
        reasoning: action.request.reasoning,
        status: action.status,
        riskScore: action.riskScore,
        requiresApproval: action.requiresApproval,
        result: action.result,
        createdAt: new Date(),
      },
    });

    await db.$disconnect();
  },
};
```

## Step 5: Enhance Chat Route

Update `/tmp/csuite/apps/api/src/routes/chat.routes.ts`:

```typescript
import { PersonaActionExecutor, parseActionRequest } from '@vea/core';
import { vpaOrchestratorAdapter } from '../services/vpa-orchestrator-adapter.js';
import { personaActionLogger } from '../services/persona-action-logger.js';

// Create executor instance
const executor = new PersonaActionExecutor({
  orchestrator: vpaOrchestratorAdapter,
  logger: personaActionLogger,
  requireApproval: true,
  riskThreshold: 50,
});

router.post('/chat', async (req, res) => {
  const { message, conversationId, personaId = 'ceo' } = req.body;
  const { tenantId, userId } = req.auth;

  // Build prompt with tool awareness
  const messages = await buildCEOPromptWithTools(message, {
    tenantId,
    userId,
    conversationId,
  });

  // Get LLM response
  const llmResponse = await streamLLMResponse(messages);

  // Check if persona wants to execute a tool
  const actionRequest = parseActionRequest(llmResponse);

  if (actionRequest) {
    // Persona wants to take action!
    const action = await executor.executePersonaAction(
      actionRequest,
      userId,
      tenantId
    );

    if (action.status === 'pending') {
      // Action requires approval
      res.json({
        message: llmResponse,
        actionRequest: action,
        requiresApproval: true,
      });
    } else if (action.status === 'completed') {
      // Action executed successfully
      res.json({
        message: llmResponse,
        actionResult: action.result,
        executedAction: action,
      });
    } else {
      // Action failed
      res.json({
        message: llmResponse,
        actionError: action.result?.error,
        failedAction: action,
      });
    }
  } else {
    // Normal response, no action
    res.json({ message: llmResponse });
  }
});
```

## Step 6: Enhance Board Meeting

Update `/tmp/csuite/apps/api/src/services/board-meeting.ts`:

```typescript
import {
  PersonaActionExecutor,
  parseActionRequest,
  formatActionResultForContext,
  type PersonaAction,
} from '@vea/core';
import { vpaOrchestratorAdapter } from './vpa-orchestrator-adapter.js';
import { personaActionLogger } from './persona-action-logger.js';

const executor = new PersonaActionExecutor({
  orchestrator: vpaOrchestratorAdapter,
  logger: personaActionLogger,
  requireApproval: true,
  riskThreshold: 50,
});

export async function orchestrateBoardMeetingWithTools(
  agenda: AgendaTemplateItem[],
  context: BoardMeetingContext,
  tenantId: string,
  userId: string
) {
  const executedActions: PersonaAction[] = [];
  const pendingActions: PersonaAction[] = [];

  // For each agenda item
  for (const agendaItem of agenda) {
    const persona = agendaItem.personaId;

    // Build persona prompt with tools
    const messages = await buildPersonaPrompt(persona, agendaItem, context);

    // Get persona response
    const response = await getLLMResponse(messages);

    // Check if persona wants to execute a tool
    const actionRequest = parseActionRequest(response);

    if (actionRequest) {
      const action = await executor.executePersonaAction(
        actionRequest,
        userId,
        tenantId
      );

      if (action.status === 'pending') {
        pendingActions.push(action);
      } else if (action.status === 'completed') {
        executedActions.push(action);

        // Update context with action result for next personas
        const actionSummary = formatActionResultForContext(action);
        context.sharedInsights.push({
          personaId: persona,
          insight: actionSummary,
          actionTaken: actionRequest,
        });
      }
    }

    // Store persona turn
    await storePersonaTurn({
      meetingId: context.meetingId,
      personaId: persona,
      response,
      executedActions: actionRequest ? [action] : [],
    });
  }

  return {
    ...context,
    executedActions,
    pendingActions,
  };
}
```

## Step 7: Add Database Schema

Add to `/tmp/csuite/packages/db/prisma/schema.prisma`:

```prisma
model PersonaAction {
  id               String   @id @default(cuid())
  tenantId         String
  userId           String
  personaId        String   // 'ceo', 'cfo', 'cmo', 'cto'
  tool             String   // 'vpa_prospects', etc.
  action           String   // 'search', 'add', etc.
  parameters       Json
  reasoning        String?
  status           String   // 'pending', 'completed', 'failed', 'denied'
  riskScore        Int
  requiresApproval Boolean
  result           Json?
  createdAt        DateTime @default(now())

  user   User   @relation(fields: [userId, tenantId], references: [id, tenantId])

  @@index([tenantId, userId])
  @@index([tenantId, personaId])
  @@index([status])
}
```

Run migration:
```bash
cd /tmp/csuite
pnpm db:migrate
```

## Step 8: Test Integration

Create `/tmp/csuite/apps/api/tests/integration/persona-tools.test.ts`:

```typescript
import { PersonaActionExecutor, getPersonaTools } from '@vea/core';
import { vpaOrchestratorAdapter } from '../../src/services/vpa-orchestrator-adapter.js';

describe('Persona Tool Execution', () => {
  it('CEO can use ProspectFinder', async () => {
    const ceoTools = getPersonaTools('ceo');
    const prospectsTool = ceoTools.find(t => t.tool === 'vpa_prospects');

    expect(prospectsTool).toBeDefined();
    expect(prospectsTool?.actions).toContain('search');
  });

  it('CEO can execute prospect search', async () => {
    const executor = new PersonaActionExecutor({
      orchestrator: vpaOrchestratorAdapter,
      requireApproval: false, // Disable for test
    });

    const action = await executor.executePersonaAction(
      {
        personaId: 'ceo',
        tool: 'vpa_prospects',
        action: 'search',
        parameters: { industry: 'HVAC', location: 'Dallas', limit: 5 },
        reasoning: 'Test search',
      },
      'test-user-id',
      'test-tenant-id'
    );

    expect(action.status).toBe('completed');
    expect(action.result?.success).toBe(true);
  });

  it('CFO cannot use marketing tools', async () => {
    const executor = new PersonaActionExecutor({
      orchestrator: vpaOrchestratorAdapter,
    });

    await expect(
      executor.executePersonaAction(
        {
          personaId: 'cfo',
          tool: 'vpa_content',
          action: 'generate_blog',
          parameters: {},
          reasoning: 'Should fail',
        },
        'test-user-id',
        'test-tenant-id'
      )
    ).rejects.toThrow('does not have permission');
  });
});
```

## Next Steps

1. Run the integration tests
2. Test CEO using ProspectFinder via chat
3. Test board meeting with tool execution
4. Add UI for pending action approvals
5. Expand to all 4 personas

## Troubleshooting

**Issue:** `Cannot find module '@vea/core'`
- **Solution:** Run `pnpm install` in csuite root

**Issue:** Persona actions not logging
- **Solution:** Check database migration was applied

**Issue:** Tool execution fails
- **Solution:** Ensure VPA-Core is properly configured with license keys

**Issue:** All actions require approval
- **Solution:** Adjust `riskThreshold` in PersonaExecutorConfig
