import { Router as createRouter } from 'express';
import type { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { createTenantClient } from '@ocsuite/db';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { apiLogger } from '../utils/logger.js';
import {
  enrichActionItemWithAssignee,
  mapBoardActionItemRecord,
  parsePersonaPayload,
} from '../services/board-meeting.js';
import { getPersonaById } from '@ocsuite/module-sdk';
import { parseJsonRecord } from '../utils/json.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  persona: z.enum(['ceo', 'cfo', 'cmo']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const updateActionItemSchema = z.object({
  status: z.enum(['open', 'in_progress', 'completed']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

const router: Router = createRouter();

router.get(
  '/meetings',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const query = listQuerySchema.parse(req.query);

    const prisma = createTenantClient({ tenantId });

    try {
      const where: Prisma.BoardMeetingWhereInput = { tenantId };

      if (query.from || query.to) {
        where.startedAt = {};
        if (query.from) {
          where.startedAt.gte = new Date(query.from);
        }
        if (query.to) {
          where.startedAt.lte = new Date(query.to);
        }
      }

      if (query.persona) {
        where.personaTurns = {
          some: {
            persona: query.persona,
          },
        };
      }

      const skip = (query.page - 1) * query.pageSize;

      const [meetings, total] = await Promise.all([
        prisma.boardMeeting.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip,
          take: query.pageSize,
          include: {
            actionItems: {
              select: {
                status: true,
              },
            },
            personaTurns: {
              select: {
                id: true,
              },
            },
          },
        }),
        prisma.boardMeeting.count({ where }),
      ]);

      const data = meetings.map((meeting) => ({
        id: meeting.id,
        tenantId: meeting.tenantId,
        startedAt: meeting.startedAt.toISOString(),
        endedAt: meeting.endedAt ? meeting.endedAt.toISOString() : null,
        agenda: meeting.agenda,
        agendaVersion: meeting.agendaVersion,
        outcomeSummary: meeting.outcomeSummary,
        tokenUsage: meeting.tokenUsage as Record<string, unknown> | null,
        rating: meeting.rating,
        metadata: meeting.metadata,
        createdAt: meeting.createdAt.toISOString(),
        updatedAt: meeting.updatedAt.toISOString(),
        personaCount: meeting.personaTurns.length,
        actionItemCounts: {
          open: meeting.actionItems.filter((item) => item.status === 'open').length,
          in_progress: meeting.actionItems.filter((item) => item.status === 'in_progress').length,
          completed: meeting.actionItems.filter((item) => item.status === 'completed').length,
        },
      }));

      return res.json({
        data,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pageCount: Math.ceil(total / query.pageSize),
        },
      });
    } catch (error) {
      apiLogger.error('Failed to list board meetings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId,
      });
      return res.status(500).json({
        error: {
          code: 'BOARD_MEETING_LIST_ERROR',
          message: 'Failed to list board meetings',
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
);

router.get(
  '/meetings/:id',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const meetingId = req.params.id;
    const prisma = createTenantClient({ tenantId });

    try {
      const meeting = await prisma.boardMeeting.findFirst({
        where: { id: meetingId, tenantId },
        include: {
          personaTurns: {
            orderBy: { sequence: 'asc' },
          },
          actionItems: {
            orderBy: { createdAt: 'asc' },
            include: {
              assignee: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      });

      if (!meeting) {
        return res.status(404).json({
          error: {
            code: 'BOARD_MEETING_NOT_FOUND',
            message: 'Board meeting not found',
          },
        });
      }

      const metadataRecord = meeting.metadata
        ? parseJsonRecord(meeting.metadata)
        : null;
      const summary = metadataRecord?.summary ?? {
        narrative: meeting.outcomeSummary ?? '',
        highlights: [],
        risks: [],
        blockers: [],
        nextSteps: [],
      };

      const metrics = (metadataRecord?.metrics as Record<string, unknown> | null) ?? null;

      const personaAnalyses = meeting.personaTurns.map((turn) => {
        const persona = getPersonaById(turn.persona);
        const metricsRecord = turn.metrics ? parseJsonRecord(turn.metrics) : null;
        const cachedParsed = metricsRecord?.parsed as ReturnType<typeof parsePersonaPayload> | undefined;
        const parsed = cachedParsed ?? parsePersonaPayload(turn.content);
        return {
          personaId: turn.persona,
          personaName: persona?.name ?? turn.persona.toUpperCase(),
          summary: parsed.summary,
          risks: parsed.risks,
          opportunities: parsed.opportunities,
          recommendations: parsed.recommendations,
          metrics: parsed.metrics ?? null,
          rawContent: turn.content,
          sequence: turn.sequence,
          createdAt: turn.createdAt.toISOString(),
        };
      });

      const actionItems = meeting.actionItems.map((item) =>
        enrichActionItemWithAssignee(
          mapBoardActionItemRecord(item),
          item.assignee
        )
      );

      return res.json({
        data: {
          id: meeting.id,
          tenantId: meeting.tenantId,
          startedAt: meeting.startedAt.toISOString(),
          endedAt: meeting.endedAt ? meeting.endedAt.toISOString() : null,
          agendaVersion: meeting.agendaVersion,
          agenda: meeting.agenda,
          summary,
          metrics,
          personaTurns: personaAnalyses,
          actionItems,
          rating: meeting.rating,
          tokenUsage: meeting.tokenUsage as Record<string, unknown> | null,
          createdAt: meeting.createdAt.toISOString(),
          updatedAt: meeting.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      apiLogger.error('Failed to fetch board meeting detail', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId,
        meetingId,
      });
      return res.status(500).json({
        error: {
          code: 'BOARD_MEETING_FETCH_ERROR',
          message: 'Failed to fetch board meeting detail',
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
);

router.patch(
  '/action-items/:id',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const itemId = req.params.id;
    const body = updateActionItemSchema.parse(req.body ?? {});

    const prisma = createTenantClient({ tenantId });

    try {
      const updates: Prisma.BoardActionItemUpdateInput = {};

      if (body.status) {
        updates.status = body.status;
      }
      if (body.assigneeId !== undefined) {
        updates.assignee = body.assigneeId
          ? { connect: { id: body.assigneeId } }
          : { disconnect: true };
      }
      if (body.dueDate !== undefined) {
        updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
      }
      if (body.title) {
        updates.title = body.title;
      }
      if (body.description !== undefined) {
        updates.description = body.description;
      }
      if (body.priority) {
        updates.priority = body.priority;
      }

      const updated = await prisma.boardActionItem.update({
        where: { id: itemId },
        data: updates,
        include: {
          assignee: {
            include: {
              user: true,
            },
          },
        },
      });

      if (updated.tenantId !== tenantId) {
        return res.status(404).json({
          error: {
            code: 'BOARD_ACTION_ITEM_NOT_FOUND',
            message: 'Action item not found',
          },
        });
      }

      return res.json({
        data: enrichActionItemWithAssignee(
          mapBoardActionItemRecord(updated),
          updated.assignee
        ),
      });
    } catch (error) {
      apiLogger.error('Failed to update board action item', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId,
        itemId,
      });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'BOARD_ACTION_ITEM_NOT_FOUND',
            message: 'Action item not found',
          },
        });
      }
      return res.status(500).json({
        error: {
          code: 'BOARD_ACTION_ITEM_UPDATE_ERROR',
          message: 'Failed to update action item',
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
);

const submitRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
});

router.patch(
  '/meetings/:id/rating',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const meetingId = req.params.id;
    const body = submitRatingSchema.parse(req.body ?? {});

    const prisma = createTenantClient({ tenantId, userId });

    try {
      const meeting = await prisma.boardMeeting.findFirst({
        where: { id: meetingId, tenantId },
        select: { id: true, tenantId: true, endedAt: true },
      });

      if (!meeting) {
        return res.status(404).json({
          error: {
            code: 'BOARD_MEETING_NOT_FOUND',
            message: 'Board meeting not found',
          },
        });
      }

      if (!meeting.endedAt) {
        return res.status(400).json({
          error: {
            code: 'MEETING_NOT_COMPLETED',
            message: 'Cannot rate a meeting that has not completed',
          },
        });
      }

      const updated = await prisma.boardMeeting.update({
        where: { id: meetingId },
        data: { rating: body.rating },
        select: {
          id: true,
          rating: true,
          updatedAt: true,
        },
      });

      apiLogger.info('Board meeting rated', {
        meetingId,
        tenantId,
        userId,
        rating: body.rating,
      });

      return res.json({
        data: {
          id: updated.id,
          rating: updated.rating,
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      apiLogger.error('Failed to submit board meeting rating', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId,
        meetingId,
      });
      return res.status(500).json({
        error: {
          code: 'RATING_SUBMISSION_ERROR',
          message: 'Failed to submit meeting rating',
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
);

export default router;
