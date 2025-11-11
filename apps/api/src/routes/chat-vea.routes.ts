/**
 * VEA-Enhanced Chat Routes
 *
 * This is an enhanced version of chat.routes.ts that integrates VEA Core
 * for persona tool execution.
 *
 * To enable VEA functionality:
 * 1. Import this route instead of chat.routes.ts in your app setup
 * 2. Ensure DATABASE_URL is configured
 * 3. Connect real VPA-Core orchestrator (or use mock for testing)
 *
 * Features:
 * - Tool-aware prompts that teach personas about available tools
 * - Automatic action request parsing from LLM responses
 * - Persona action execution through @vea/core
 * - Action results streamed back to client via SSE
 * - Full audit trail of all persona actions
 */

import { Router as createRouter } from 'express';
import type { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { createTenantClient } from '@ocsuite/db';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { apiLogger, sseLogger } from '../utils/logger.js';
import { streamCompletion, estimateTokens } from '../services/llm/fireworks-client.js';
import { buildPersonaPrompt } from '../services/llm/prompt-builder.js';
import { chatRateLimiter } from '../middleware/rate-limit.js';
import {
  parseActionRequest,
  formatActionResultForContext,
  type PersonaId
} from '@vea/core';

const router: Router = createRouter();

const chatRateLimiterMiddleware: RequestHandler = process.env.NODE_ENV === 'test'
  ? (_req, _res, next) => next()
  : chatRateLimiter;

const personaTypeSchema = z.enum(['ceo', 'cfo', 'cmo', 'cto']);

const listConversationsQuerySchema = z.object({
  personaType: personaTypeSchema.optional(),
});

const createConversationSchema = z.object({
  personaType: personaTypeSchema,
  title: z.string().min(1).max(120).optional(),
});

const chatRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(5000, 'Message too long'),
  conversationId: z.string().uuid().optional(),
  personaType: personaTypeSchema.optional(),
  veaEnabled: z.boolean().optional().default(true), // Enable VEA by default
});

/**
 * GET /c-suite/vea/conversations
 */
router.get(
  '/conversations',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const parseQuery = listConversationsQuerySchema.safeParse(req.query);

    if (!parseQuery.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: parseQuery.error.format(),
        },
      });
    }

    const { personaType } = parseQuery.data;
    const db = createTenantClient({ tenantId, userId });

    try {
      const conversations = await db.conversation.findMany({
        where: {
          tenantId,
          ...(personaType ? { personaType } : {}),
        },
        orderBy: [{ updatedAt: 'desc' }],
      });

      return res.status(200).json({
        success: true,
        data: conversations,
      });
    } catch (error) {
      apiLogger.error('[VEA] Failed to list conversations', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({
        success: false,
        error: {
          code: 'CONVERSATION_LIST_ERROR',
          message: 'Failed to fetch conversations',
        },
      });
    } finally {
      await db.$disconnect();
    }
  }
);

/**
 * POST /c-suite/vea/conversations
 */
router.post(
  '/conversations',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const parseBody = createConversationSchema.safeParse(req.body);

    if (!parseBody.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parseBody.error.format(),
        },
      });
    }

    const { personaType, title } = parseBody.data;
    const db = createTenantClient({ tenantId, userId });

    try {
      const conversation = await db.conversation.create({
        data: {
          tenantId,
          userId,
          personaType,
          title: title || `VEA Session with ${personaType.toUpperCase()}`,
        },
      });

      return res.status(201).json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      apiLogger.error('[VEA] Failed to create conversation', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({
        success: false,
        error: {
          code: 'CONVERSATION_CREATE_ERROR',
          message: 'Failed to create conversation',
        },
      });
    } finally {
      await db.$disconnect();
    }
  }
);

/**
 * GET /c-suite/vea/conversations/:conversationId
 */
router.get(
  '/conversations/:conversationId',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const conversationId = req.params.conversationId;

    if (!z.string().uuid().safeParse(conversationId).success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CONVERSATION_ID',
          message: 'Conversation ID must be a valid UUID',
        },
      });
    }

    const db = createTenantClient({ tenantId, userId });

    try {
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, tenantId },
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CONVERSATION_NOT_FOUND',
            message: 'Conversation not found',
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      apiLogger.error('[VEA] Failed to fetch conversation', {
        tenantId,
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({
        success: false,
        error: {
          code: 'CONVERSATION_FETCH_ERROR',
          message: 'Failed to fetch conversation',
        },
      });
    } finally {
      await db.$disconnect();
    }
  }
);

/**
 * GET /c-suite/vea/conversations/:conversationId/messages
 */
router.get(
  '/conversations/:conversationId/messages',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const conversationId = req.params.conversationId;

    if (!z.string().uuid().safeParse(conversationId).success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CONVERSATION_ID',
          message: 'Conversation ID must be a valid UUID',
        },
      });
    }

    const db = createTenantClient({ tenantId, userId });

    try {
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, tenantId },
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CONVERSATION_NOT_FOUND',
            message: 'Conversation not found',
          },
        });
      }

      const messages = await db.message.findMany({
        where: { conversationId, tenantId },
        orderBy: [{ createdAt: 'asc' }],
      });

      return res.status(200).json({
        success: true,
        data: messages,
      });
    } catch (error) {
      apiLogger.error('[VEA] Failed to fetch messages for conversation', {
        tenantId,
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({
        success: false,
        error: {
          code: 'CONVERSATION_MESSAGES_ERROR',
          message: 'Failed to fetch conversation messages',
        },
      });
    } finally {
      await db.$disconnect();
    }
  }
);

/**
 * Fetch context data for prompt building
 */
const fetchPromptContext = async (
  tenantId: string,
  userId: string,
  conversationId?: string
) => {
  const prisma = createTenantClient({ tenantId, userId });

  try {
    const businessProfile = await prisma.businessProfile.findUnique({
      where: { tenantId },
    });

    const recentInsights = await prisma.moduleInsight.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    const recentAnalytics = await prisma.analyticsSnapshot.findFirst({
      where: { tenantId },
      orderBy: { date: 'desc' },
    });

    // Fetch recent persona actions for this conversation
    const recentActions = conversationId
      ? await prisma.personaAction.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
      : [];

    return {
      conversationId,
      businessProfile: businessProfile
        ? {
            industry: businessProfile.industry || '',
            size: businessProfile.size || '',
            stage: businessProfile.stage || '',
            revenue: businessProfile.revenue || undefined,
            goals: businessProfile.goals || [],
          }
        : undefined,
      recentInsights: recentInsights.map((i) => ({
        moduleSlug: i.moduleSlug,
        summary: i.summary,
        highlights: i.highlights,
      })),
      recentAnalytics: recentAnalytics
        ? {
            sessions: recentAnalytics.sessions,
            users: recentAnalytics.users,
            conversions: recentAnalytics.conversions,
            revenue: recentAnalytics.revenue,
          }
        : undefined,
      recentActions: recentActions.map((a) => ({
        tool: a.tool,
        action: a.action,
        status: a.status,
        result: a.result,
      })),
    };
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Build tool-aware prompt that teaches persona about available tools
 */
async function buildToolAwarePrompt(
  message: string,
  context: any,
  personaId: PersonaId
): Promise<Array<{ role: string; content: string }>> {
  // Import tool registry to get persona's available tools
  const { getPersonaTools } = await import('@vea/core');
  const availableTools = getPersonaTools(personaId);

  // Build base prompt
  const baseMessages = await buildPersonaPrompt(message, context, personaId);

  // Enhance system prompt with tool awareness
  const systemMessage = baseMessages[0];
  const enhancedSystemPrompt = `${systemMessage.content}

🔧 TOOL EXECUTION CAPABILITY

You have the ability to not only ADVISE but also EXECUTE actions through these tools:

${availableTools
  .map(
    (tool) =>
      `- ${tool.name}: ${tool.description}
   Actions: ${tool.actions.join(', ')}`
  )
  .join('\n')}

When you want to execute a tool, include a JSON block in your response using this format:

{
  "type": "action",
  "personaId": "${personaId}",
  "tool": "vpa_prospects",
  "action": "search",
  "parameters": { "industry": "HVAC", "location": "Dallas, TX", "limit": 50 },
  "reasoning": "Finding HVAC prospects to build sales pipeline"
}

The action will be executed automatically and the results will be returned to you and the user.

IMPORTANT:
- Only use tools you have access to (listed above)
- Provide clear reasoning for each action
- Parameters should match the expected format for each tool
- You can combine advice with action execution in the same response
`;

  return [
    { role: 'system', content: enhancedSystemPrompt },
    ...baseMessages.slice(1),
  ];
}

/**
 * POST /c-suite/vea/chat
 *
 * VEA-Enhanced chat endpoint with tool execution support
 *
 * This endpoint:
 * 1. Uses tool-aware prompts that teach personas about available tools
 * 2. Parses action requests from LLM responses
 * 3. Executes persona actions through @vea/core
 * 4. Returns both LLM response and action results via SSE
 *
 * SSE Event Types:
 * - start: Initial metadata
 * - chunk: LLM response chunk
 * - action: Persona action executed (includes result)
 * - done: Stream complete
 * - error: Error occurred
 */
router.post(
  '/chat',
  requireAuth(),
  resolveTenant(),
  chatRateLimiterMiddleware,
  async (req: Request, res: Response) => {
    try {
      const parseResult = chatRequestSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request data',
          details: parseResult.error.format(),
          code: 'VALIDATION_ERROR',
        });
      }

      const { message, conversationId, personaType, veaEnabled } = parseResult.data;
      const tenantId = req.tenantId!;
      const userId = req.clerkId!;
      const targetPersona = (personaType ?? 'ceo') as PersonaId;

      apiLogger.info('[VEA] Chat request received', {
        tenantId,
        userId,
        conversationId,
        personaType: targetPersona,
        veaEnabled,
        messageLength: message.length,
      });

      const db = createTenantClient({ tenantId, userId });

      try {
        // Find or create conversation
        let conversation;
        if (conversationId) {
          conversation = await db.conversation.findFirst({
            where: { id: conversationId, tenantId },
          });

          if (!conversation) {
            return res.status(404).json({
              error: 'Not Found',
              message: 'Conversation not found',
              code: 'CONVERSATION_NOT_FOUND',
            });
          }
        } else {
          conversation = await db.conversation.create({
            data: {
              tenantId,
              userId,
              personaType: targetPersona,
              title: message.slice(0, 80),
            },
          });
        }

        // Save user's message
        await db.message.create({
          data: {
            conversationId: conversation.id,
            tenantId,
            role: 'user',
            content: message,
            metadata: { personaType: targetPersona, veaEnabled },
          },
        });

        // Fetch context for prompt building
        const promptContext = await fetchPromptContext(tenantId, userId, conversation.id);

        // Build tool-aware prompt
        const promptMessages = veaEnabled
          ? await buildToolAwarePrompt(message, { ...promptContext, tenantId, userId }, targetPersona)
          : await buildPersonaPrompt(message, { ...promptContext, tenantId, userId }, targetPersona);

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
              personaType: targetPersona,
              veaEnabled,
            },
          })}\n\n`
        );

        sseLogger.info('[VEA] Started SSE stream', {
          conversationId: conversation.id,
          personaType: targetPersona,
          veaEnabled,
          tenantId,
        });

        // Mock response for test environment
        if (process.env.NODE_ENV === 'test') {
          const mockContent = 'This is a mocked VEA response for testing.';

          res.write(
            `data: ${JSON.stringify({
              type: 'chunk',
              data: { content: mockContent, conversationId: conversation.id },
            })}\n\n`
          );

          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              data: { conversationId: conversation.id, actionExecuted: false },
            })}\n\n`
          );

          await db.message.create({
            data: {
              conversationId: conversation.id,
              tenantId,
              role: 'assistant',
              content: mockContent,
              metadata: { personaType: targetPersona, veaEnabled },
            },
          });

          res.end();
          return;
        }

        // Stream LLM response
        let fullResponse = '';
        let inputTokens = estimateTokens(promptMessages.map((m) => m.content).join(' '));
        let outputTokens = 0;

        try {
          for await (const chunk of streamCompletion({
            messages: promptMessages,
            tenantId,
            userId,
          })) {
            if (chunk.done) {
              break;
            }

            fullResponse += chunk.content;
            res.write(
              `data: ${JSON.stringify({
                type: 'chunk',
                data: { content: chunk.content, conversationId: conversation.id },
              })}\n\n`
            );
          }

          outputTokens = estimateTokens(fullResponse);

          // Save assistant message
          await db.message.create({
            data: {
              conversationId: conversation.id,
              tenantId,
              role: 'assistant',
              content: fullResponse,
              metadata: {
                model: 'qwen2p5-72b-instruct',
                personaType: targetPersona,
                veaEnabled,
                tokens: {
                  input: inputTokens,
                  output: outputTokens,
                  total: inputTokens + outputTokens,
                },
              },
            },
          });

          // Parse and execute action if VEA is enabled
          let actionExecuted = false;
          let actionStatus = null;

          if (veaEnabled) {
            const actionRequest = parseActionRequest(fullResponse);

            if (actionRequest) {
              apiLogger.info('[VEA] Action detected in response', {
                personaId: actionRequest.personaId,
                tool: actionRequest.tool,
                action: actionRequest.action,
                conversationId: conversation.id,
                tenantId,
              });

              try {
                // Dynamically import persona executor
                const { personaExecutor } = await import('../services/persona-executor-instance.js');

                const action = await personaExecutor.executePersonaAction(
                  actionRequest,
                  userId,
                  tenantId
                );

                actionExecuted = true;
                actionStatus = action.status;

                // Send action result
                res.write(
                  `data: ${JSON.stringify({
                    type: 'action',
                    data: {
                      action: {
                        personaId: action.request.personaId,
                        tool: action.request.tool,
                        action: action.request.action,
                        status: action.status,
                        riskScore: action.riskScore,
                        requiresApproval: action.requiresApproval,
                      },
                      result: action.result,
                      summary: formatActionResultForContext(action),
                    },
                  })}\n\n`
                );

                apiLogger.info('[VEA] Action executed successfully', {
                  personaId: actionRequest.personaId,
                  tool: actionRequest.tool,
                  action: actionRequest.action,
                  status: action.status,
                  conversationId: conversation.id,
                  tenantId,
                });
              } catch (actionError: any) {
                apiLogger.error('[VEA] Action execution failed', {
                  error: actionError.message,
                  personaId: actionRequest.personaId,
                  tool: actionRequest.tool,
                  action: actionRequest.action,
                  conversationId: conversation.id,
                  tenantId,
                });

                res.write(
                  `data: ${JSON.stringify({
                    type: 'action',
                    data: {
                      action: {
                        personaId: actionRequest.personaId,
                        tool: actionRequest.tool,
                        action: actionRequest.action,
                        status: 'failed',
                      },
                      error: actionError.message,
                    },
                  })}\n\n`
                );
              }
            }
          }

          // Send done event
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              data: {
                conversationId: conversation.id,
                actionExecuted,
                actionStatus,
              },
            })}\n\n`
          );

          // Touch conversation
          await db.conversation.update({
            where: { id: conversation.id },
            data: { updatedAt: new Date() },
          });

          res.end();

          sseLogger.info('[VEA] Completed SSE stream', {
            conversationId: conversation.id,
            actionExecuted,
            actionStatus,
            tenantId,
            tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
          });
        } catch (streamError) {
          apiLogger.error('[VEA] Error during LLM streaming', {
            error: streamError instanceof Error ? streamError.message : 'Unknown error',
            tenantId,
            conversationId: conversation.id,
          });

          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: 'Failed to generate response. Please try again.',
            })}\n\n`
          );
          res.end();
        }
      } finally {
        await db.$disconnect();
      }
    } catch (error) {
      apiLogger.error('[VEA] Error in chat endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        tenantId: req.tenantId,
        userId: req.clerkId,
      });

      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to process chat request',
          code: 'CHAT_ERROR',
        });
      } else {
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: 'An error occurred during streaming',
          })}\n\n`
        );
        res.end();
      }
    }
  }
);

export default router;
