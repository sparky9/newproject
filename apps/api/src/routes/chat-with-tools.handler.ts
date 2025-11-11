/**
 * Enhanced Chat Handler with Tool Execution
 *
 * Extends the chat route to support persona tool execution via @vea/core
 *
 * This handler:
 * 1. Uses tool-aware prompts
 * 2. Parses action requests from LLM responses
 * 3. Executes persona actions
 * 4. Returns both response and action results
 */

import type { Request, Response } from 'express';
import { createTenantClient } from '@ocsuite/db';
import { apiLogger, sseLogger } from '../utils/logger.js';
import { streamCompletion } from '../services/llm/fireworks-client.js';
import {
  buildCEOPromptWithTools,
  buildCFOPromptWithTools,
  buildCMOPromptWithTools,
  buildCTOPromptWithTools,
  buildSmartPersonaPrompt,
} from '../services/llm/prompt-builder-with-tools.js';
import { parseActionRequest, type PersonaId } from '@vea/core';
import { personaExecutor } from '../services/persona-executor-instance.js';

/**
 * Build persona prompt with tool awareness
 */
async function buildToolAwarePrompt(
  message: string,
  context: any,
  personaId: PersonaId
) {
  // Use smart builder that decides based on user intent
  return buildSmartPersonaPrompt(message, context, personaId);
}

/**
 * Handle persona action execution from LLM response
 */
async function handlePersonaAction(
  llmResponse: string,
  personaId: PersonaId,
  userId: string,
  tenantId: string
): Promise<{
  actionDetected: boolean;
  action?: any;
  actionResult?: any;
}> {
  // Parse action request from LLM response
  const actionRequest = parseActionRequest(llmResponse);

  if (!actionRequest) {
    return { actionDetected: false };
  }

  apiLogger.info('[ChatWithTools] Action detected in LLM response', {
    personaId: actionRequest.personaId,
    tool: actionRequest.tool,
    action: actionRequest.action,
    tenantId,
  });

  // Execute the action
  try {
    const action = await personaExecutor.executePersonaAction(
      actionRequest,
      userId,
      tenantId
    );

    apiLogger.info('[ChatWithTools] Action executed', {
      personaId: actionRequest.personaId,
      tool: actionRequest.tool,
      action: actionRequest.action,
      status: action.status,
      tenantId,
    });

    return {
      actionDetected: true,
      action,
      actionResult: action.result,
    };
  } catch (error: any) {
    apiLogger.error('[ChatWithTools] Action execution failed', {
      personaId: actionRequest.personaId,
      tool: actionRequest.tool,
      action: actionRequest.action,
      error: error.message,
      tenantId,
    });

    return {
      actionDetected: true,
      action: {
        request: actionRequest,
        status: 'failed',
        requiresApproval: false,
        riskScore: 0,
        result: {
          success: false,
          error: error.message,
          metadata: {
            executionTime: 0,
            timestamp: new Date(),
            module: 'unknown' as any,
          },
        },
      },
    };
  }
}

/**
 * Enhanced chat handler with tool execution support
 *
 * This is the same as the regular chat handler but:
 * - Uses tool-aware prompts
 * - Detects and executes persona actions
 * - Returns action results along with response
 *
 * To use: Replace buildPersonaPrompt with buildToolAwarePrompt
 * in the existing chat route
 */
export async function enhancedChatHandler(
  req: Request,
  res: Response,
  {
    message,
    conversationId,
    personaType,
    tenantId,
    userId,
    conversation,
    promptContext,
  }: {
    message: string;
    conversationId?: string;
    personaType: PersonaId;
    tenantId: string;
    userId: string;
    conversation: any;
    promptContext: any;
  }
) {
  try {
    // Build tool-aware prompt
    const promptMessages = await buildToolAwarePrompt(
      message,
      {
        ...promptContext,
        tenantId,
        userId,
      },
      personaType
    );

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial metadata
    res.write(
      `data: ${JSON.stringify({
        type: 'start',
        data: {
          conversationId: conversation.id,
          personaType,
          toolsEnabled: true,
        },
      })}\n\n`
    );

    sseLogger.info('[ChatWithTools] Started SSE stream with tools', {
      conversationId: conversation.id,
      personaType,
      tenantId,
    });

    // Stream LLM response
    let fullResponse = '';
    const chunks: string[] = [];

    await streamCompletion(promptMessages, {
      onChunk: (chunk) => {
        fullResponse += chunk;
        chunks.push(chunk);

        res.write(
          `data: ${JSON.stringify({
            type: 'chunk',
            data: {
              content: chunk,
              conversationId: conversation.id,
            },
          })}\n\n`
        );
      },
      onComplete: async () => {
        sseLogger.info('[ChatWithTools] Stream complete', {
          conversationId: conversation.id,
          responseLength: fullResponse.length,
          tenantId,
        });

        // Save assistant's message
        const db = createTenantClient({ tenantId, userId });

        try {
          await db.message.create({
            data: {
              conversationId: conversation.id,
              tenantId,
              role: 'assistant',
              content: fullResponse,
              metadata: {
                personaType,
                chunks: chunks.length,
                toolsEnabled: true,
              },
            },
          });
        } catch (error) {
          apiLogger.error('[ChatWithTools] Failed to save message', {
            error: error instanceof Error ? error.message : 'Unknown',
            conversationId: conversation.id,
            tenantId,
          });
        } finally {
          await db.$disconnect();
        }

        // Check for action request in response
        const actionResult = await handlePersonaAction(
          fullResponse,
          personaType,
          userId,
          tenantId
        );

        // Send action result if detected
        if (actionResult.actionDetected) {
          res.write(
            `data: ${JSON.stringify({
              type: 'action',
              data: {
                action: actionResult.action,
                result: actionResult.actionResult,
              },
            })}\n\n`
          );
        }

        // Send done event
        res.write(
          `data: ${JSON.stringify({
            type: 'done',
            data: {
              conversationId: conversation.id,
              actionExecuted: actionResult.actionDetected,
              actionStatus: actionResult.action?.status,
            },
          })}\n\n`
        );

        res.end();
      },
      onError: (error) => {
        sseLogger.error('[ChatWithTools] Stream error', {
          error: error.message,
          conversationId: conversation.id,
          tenantId,
        });

        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            data: {
              message: 'Stream error',
              error: error.message,
            },
          })}\n\n`
        );

        res.end();
      },
    });
  } catch (error: any) {
    apiLogger.error('[ChatWithTools] Handler error', {
      error: error.message,
      conversationId: conversation.id,
      tenantId,
    });

    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        data: {
          message: 'Handler error',
          error: error.message,
        },
      })}\n\n`
    );

    res.end();
  }
}
