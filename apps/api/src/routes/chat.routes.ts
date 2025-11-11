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
});

/**
 * GET /c-suite/ceo/conversations
 *
 * Returns list of conversations for the authenticated tenant
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
      apiLogger.error('Failed to list conversations', {
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
 * POST /c-suite/ceo/conversations
 *
 * Create a new conversation for the current tenant
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
          title: title || `Conversation with ${personaType.toUpperCase()}`,
        },
      });

      return res.status(201).json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      apiLogger.error('Failed to create conversation', {
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
 * GET /c-suite/ceo/conversations/:conversationId
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
      apiLogger.error('Failed to fetch conversation', {
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
 * GET /c-suite/ceo/conversations/:conversationId/messages
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
      apiLogger.error('Failed to fetch messages for conversation', {
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
    // Fetch business profile
    const businessProfile = await prisma.businessProfile.findUnique({
      where: { tenantId },
    });

    // Fetch recent insights (last 3)
    const recentInsights = await prisma.moduleInsight.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    // Fetch recent analytics snapshot
    const recentAnalytics = await prisma.analyticsSnapshot.findFirst({
      where: { tenantId },
      orderBy: { date: 'desc' },
    });

    return {
      conversationId,
      businessProfile: businessProfile ? {
        industry: businessProfile.industry || '',
        size: businessProfile.size || '',
        stage: businessProfile.stage || '',
        revenue: businessProfile.revenue || undefined,
        goals: businessProfile.goals || [],
      } : undefined,
      recentInsights: recentInsights.map(i => ({
        moduleSlug: i.moduleSlug,
        summary: i.summary,
        highlights: i.highlights,
      })),
      recentAnalytics: recentAnalytics ? {
        sessions: recentAnalytics.sessions,
        users: recentAnalytics.users,
        conversions: recentAnalytics.conversions,
        revenue: recentAnalytics.revenue,
      } : undefined,
    };
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * POST /c-suite/ceo/chat
 *
 * Chat with the CEO assistant using Server-Sent Events for streaming responses
 *
 * Request body:
 * - message: string (required) - User's message
 * - conversationId: string (optional) - UUID of existing conversation
 *
 * Response:
 * - SSE stream with chunks of the CEO's response
 */
router.post(
  '/chat',
  requireAuth(),
  resolveTenant(),
  chatRateLimiterMiddleware,
  async (req: Request, res: Response) => {
    try {
      // Validate request body
      const parseResult = chatRequestSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request data',
          details: parseResult.error.format(),
          code: 'VALIDATION_ERROR',
        });
      }

      const { message, conversationId, personaType } = parseResult.data;
      const tenantId = req.tenantId!;
      const userId = req.clerkId!;
      const targetPersona = personaType ?? 'ceo';

      apiLogger.info('Chat request received', {
        tenantId,
        userId,
        conversationId,
        messageLength: message.length,
      });

      // Get tenant-scoped database client
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
          // Create new conversation with selected persona
          conversation = await db.conversation.create({
            data: {
              tenantId,
              userId,
              personaType: targetPersona,
              title: message.slice(0, 80),
            },
          });

          apiLogger.info('Created new conversation', {
            conversationId: conversation.id,
            tenantId,
            userId,
            personaType: targetPersona,
          });
        }

        // Save user's message
        await db.message.create({
          data: {
            conversationId: conversation.id,
            tenantId,
            role: 'user',
            content: message,
            metadata: { personaType: targetPersona },
          },
        });

        // Fetch context for prompt building
        const promptContext = await fetchPromptContext(
          tenantId,
          userId,
          conversation.id
        );

        // Build prompt with context
        const promptMessages = await buildPersonaPrompt(
          message,
          {
            ...promptContext,
            tenantId,
            userId,
          },
          targetPersona
        );

        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

        // Send initial metadata
        res.write(`data: ${JSON.stringify({
          type: 'start',
          data: {
            conversationId: conversation.id,
            personaType: targetPersona,
          },
        })}\n\n`);

        sseLogger.info('Started SSE stream', {
          conversationId: conversation.id,
          tenantId,
        });

        // Provide a deterministic response in test environments to avoid external dependencies
        if (process.env.NODE_ENV === 'test') {
          const mockContent = 'This is a mocked strategic summary for testing.';

          res.write(`data: ${JSON.stringify({
            type: 'chunk',
            data: {
              content: mockContent,
              conversationId: conversation.id,
            },
          })}\n\n`);

          res.write(`data: ${JSON.stringify({
            type: 'done',
            data: {
              conversationId: conversation.id,
            },
          })}\n\n`);

          await db.message.create({
            data: {
              conversationId: conversation.id,
              tenantId,
              role: 'assistant',
              content: mockContent,
              metadata: {
                model: 'qwen2p5-72b-instruct',
                personaType: targetPersona,
                tokens: {
                  input: 0,
                  output: 0,
                  total: 0,
                },
              },
            },
          });

          await db.conversation.update({
            where: { id: conversation.id },
            data: {
              updatedAt: new Date(),
            },
          });

          res.end();
          return;
        }

        // Stream LLM response
        let fullResponse = '';
        let inputTokens = 0;
        let outputTokens = 0;

        try {
          // Estimate input tokens
          inputTokens = estimateTokens(
            promptMessages.map(m => m.content).join(' ')
          );

          for await (const chunk of streamCompletion({
            messages: promptMessages,
            tenantId,
            userId,
          })) {
            if (chunk.done) {
              res.write(`data: ${JSON.stringify({
                type: 'done',
                data: {
                  conversationId: conversation.id,
                },
              })}\n\n`);
              break;
            }

            fullResponse += chunk.content;
            res.write(`data: ${JSON.stringify({
              type: 'chunk',
              data: {
                content: chunk.content,
                conversationId: conversation.id,
              },
            })}\n\n`);
          }

          // Estimate output tokens
          outputTokens = estimateTokens(fullResponse);

          // Save assistant message with token metadata
          await db.message.create({
            data: {
              conversationId: conversation.id,
              tenantId,
              role: 'assistant',
              content: fullResponse,
              metadata: {
                model: 'qwen2p5-72b-instruct',
                personaType: targetPersona,
                tokens: {
                  input: inputTokens,
                  output: outputTokens,
                  total: inputTokens + outputTokens,
                },
              },
            },
          });

          // Touch conversation to bump updatedAt for ordering
          await db.conversation.update({
            where: { id: conversation.id },
            data: {
              updatedAt: new Date(),
            },
          });

          // End the stream
          res.end();

          sseLogger.info('Completed SSE stream', {
            conversationId: conversation.id,
            tenantId,
            tokens: {
              input: inputTokens,
              output: outputTokens,
              total: inputTokens + outputTokens,
            },
          });
        } catch (streamError) {
          apiLogger.error('Error during LLM streaming', {
            error: streamError instanceof Error ? streamError.message : 'Unknown error',
            tenantId,
            conversationId: conversation.id,
          });

          // Send error event to client
          res.write(`data: ${JSON.stringify({
            type: 'error',
            error: 'Failed to generate response. Please try again.',
          })}\n\n`);
          res.end();
        }
      } finally {
        await db.$disconnect();
      }

    } catch (error) {
      apiLogger.error('Error in chat endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        tenantId: req.tenantId,
        userId: req.clerkId,
      });

      // If headers not sent yet, send error response
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to process chat request',
          code: 'CHAT_ERROR',
        });
      } else {
        // If SSE already started, send error event
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: 'An error occurred during streaming',
        })}\n\n`);
        res.end();
      }
    }
  }
);

export default router;
