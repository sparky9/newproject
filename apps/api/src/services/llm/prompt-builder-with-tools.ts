/**
 * Enhanced Prompt Builder with Tool Awareness
 *
 * Extends the base prompt builder to make personas aware of the tools
 * they can execute via @vea/core
 *
 * This enables personas to not just advise, but EXECUTE actions!
 */

import { LLMMessage } from './fireworks-client.js';
import { PromptContext, buildPersonaPrompt } from './prompt-builder.js';
import {
  getPersonaTools,
  formatToolsForPrompt,
  type PersonaId,
} from '@vea/core';
import { logger } from '../../utils/logger.js';

/**
 * Build a tool-aware prompt for the CEO persona
 */
export async function buildCEOPromptWithTools(
  userMessage: string,
  context: PromptContext
): Promise<LLMMessage[]> {
  return buildPersonaPromptWithTools(userMessage, context, 'ceo');
}

/**
 * Build a tool-aware prompt for the CFO persona
 */
export async function buildCFOPromptWithTools(
  userMessage: string,
  context: PromptContext
): Promise<LLMMessage[]> {
  return buildPersonaPromptWithTools(userMessage, context, 'cfo');
}

/**
 * Build a tool-aware prompt for the CMO persona
 */
export async function buildCMOPromptWithTools(
  userMessage: string,
  context: PromptContext
): Promise<LLMMessage[]> {
  return buildPersonaPromptWithTools(userMessage, context, 'cmo');
}

/**
 * Build a tool-aware prompt for the CTO persona
 */
export async function buildCTOPromptWithTools(
  userMessage: string,
  context: PromptContext
): Promise<LLMMessage[]> {
  return buildPersonaPromptWithTools(userMessage, context, 'cto');
}

/**
 * Build a tool-aware prompt for any persona
 *
 * This enhances the base persona prompt with:
 * 1. List of available tools
 * 2. Instructions on how to execute tools
 * 3. Action request format
 */
async function buildPersonaPromptWithTools(
  userMessage: string,
  context: PromptContext,
  personaId: PersonaId
): Promise<LLMMessage[]> {
  // Start with base persona prompt (includes business context, history, etc.)
  const baseMessages = await buildPersonaPrompt(userMessage, context, personaId);

  // Get tools available to this persona
  const availableTools = getPersonaTools(personaId);

  logger.info('[PromptBuilderWithTools] Building tool-aware prompt', {
    personaId,
    toolCount: availableTools.length,
    tenantId: context.tenantId,
  });

  // Enhance the system prompt with tool awareness
  const systemMessage = baseMessages[0];
  if (systemMessage && systemMessage.role === 'system') {
    systemMessage.content = enhanceSystemPromptWithTools(
      systemMessage.content,
      personaId,
      availableTools
    );
  }

  return baseMessages;
}

/**
 * Enhance a system prompt with tool awareness
 */
function enhanceSystemPromptWithTools(
  basePrompt: string,
  personaId: PersonaId,
  availableTools: any[]
): string {
  const personaNames = {
    ceo: 'CEO',
    cfo: 'CFO',
    cmo: 'CMO',
    cto: 'CTO',
  };

  const personaName = personaNames[personaId];

  const enhancedPrompt = `${basePrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 TOOL EXECUTION CAPABILITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

As ${personaName}, you can not only ADVISE but also EXECUTE actions through these tools:

${formatToolsForPrompt(availableTools)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW TO EXECUTE TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When the user asks you to DO something (not just advise), you can execute a tool by including a JSON action request in your response:

{
  "type": "action",
  "personaId": "${personaId}",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": {
    "industry": "HVAC",
    "location": "Dallas",
    "limit": 50
  },
  "reasoning": "User requested HVAC leads in Dallas, executing prospect search"
}

IMPORTANT RULES:
1. Use tools when the user asks you to DO something
2. Explain what you're doing BEFORE the JSON (e.g., "I'll search for those leads now...")
3. Place the JSON action request on its own line
4. After the JSON, you can add follow-up commentary
5. If just providing advice (no action needed), respond normally without JSON

EXAMPLES:

❌ BAD (just advising):
"You should search for HVAC companies in Dallas using ProspectFinder."

✅ GOOD (executing):
"I'll search for HVAC companies in Dallas right now.

{
  "type": "action",
  "personaId": "${personaId}",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": {"industry": "HVAC", "location": "Dallas", "limit": 50},
  "reasoning": "Finding HVAC leads as requested"
}

Once I have the results, I'll help you prioritize which companies to contact first."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Remember: You are a ${personaName} who can EXECUTE, not just ADVISE. Use your tools proactively when appropriate!`;

  return enhancedPrompt;
}

/**
 * Check if user's message is requesting action (vs. just asking for advice)
 *
 * This helps decide whether to use tool-aware prompts or regular prompts
 */
export function isActionRequest(userMessage: string): boolean {
  const actionKeywords = [
    'find',
    'search',
    'create',
    'generate',
    'send',
    'make',
    'build',
    'add',
    'get me',
    'show me',
    'give me',
    'do',
    'execute',
    'run',
    'perform',
  ];

  const lowerMessage = userMessage.toLowerCase();

  return actionKeywords.some((keyword) => lowerMessage.includes(keyword));
}

/**
 * Decide which prompt builder to use based on context
 */
export async function buildSmartPersonaPrompt(
  userMessage: string,
  context: PromptContext,
  personaId: PersonaId
): Promise<LLMMessage[]> {
  // Check if user is requesting action
  const needsTools = isActionRequest(userMessage);

  if (needsTools) {
    logger.info('[PromptBuilder] Using tool-aware prompt', {
      personaId,
      userMessage: userMessage.substring(0, 100),
    });

    return buildPersonaPromptWithTools(userMessage, context, personaId);
  } else {
    logger.info('[PromptBuilder] Using standard prompt', {
      personaId,
      userMessage: userMessage.substring(0, 100),
    });

    return buildPersonaPrompt(userMessage, context, personaId);
  }
}
