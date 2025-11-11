# @vea/core

Virtual Executive Assistant Core - Enables C-suite AI personas to execute actions through MCP modules.

## Purpose

This package bridges Online C Suite AI personas (CEO, CFO, CMO, CTO) with the 16 MCP modules, allowing executives to not just advise but actually EXECUTE tasks.

## Key Components

- **Persona Tool Registry** - Defines which tools each persona can access
- **Persona Action Executor** - Executes module tools on behalf of personas
- **Action Parser** - Parses LLM responses for action requests
- **Context Manager** - Shares execution context between personas in board meetings

## Usage

```typescript
import { PersonaActionExecutor, getPersonaTools } from '@vea/core';

// Get available tools for CEO
const ceoTools = getPersonaTools('ceo', tenantId);

// Execute an action on behalf of CEO
const executor = new PersonaActionExecutor();
const result = await executor.executePersonaAction({
  personaId: 'ceo',
  tool: 'vpa_prospects',
  action: 'search',
  parameters: { industry: 'HVAC', location: 'Dallas' },
  reasoning: 'Finding leads as requested by user'
}, userId, tenantId);
```

## Integration

This package is designed to integrate with:
- **Online C Suite** (`/tmp/csuite/apps/api`) - Prompt builder and board meetings
- **VPA Core** (`/tmp/csuite/lead-gen-app/vpa-core`) - Module orchestration
- **16 MCP Modules** (`/tmp/csuite/lead-gen-app/*/`) - Actual tool execution

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test
```
