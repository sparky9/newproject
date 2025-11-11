import { Router as createRouter } from 'express';
import type { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createTenantClient } from '@ocsuite/db';
import { getPersonaById } from '@ocsuite/module-sdk';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { apiLogger, sseLogger } from '../utils/logger.js';
import {
  DEFAULT_AGENDA,
  agendaTemplateToDisplay,
  parsePersonaPayload,
  enrichActionItemWithAssignee,
  mapBoardActionItemRecord,
} from '../services/board-meeting.js';
import {
  enqueueBoardMeeting,
  getJobStatus,
} from '../queue/client.js';
import { QUEUE_NAMES } from '../queue/index.js';
import { toInputJson, parseJsonRecord } from '../utils/json.js';

const router: Router = createRouter();

const startMeetingSchema = z.object({
  agenda: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        title: z.string().min(1),
        personaId: z.enum(['ceo', 'cfo', 'cmo']),
        dependsOn: z.string().min(1).optional().nullable(),
      })
    )
    .optional(),
  agendaVersion: z.number().int().positive().max(99).optional(),
});

interface NormalizedAgendaItem {
  id: string;
  title: string;
  personaId: 'ceo' | 'cfo' | 'cmo';
  dependsOn?: string | null;
}

type PersonaPayload = ReturnType<typeof parsePersonaPayload>;

const DEFAULT_NORMALIZED_AGENDA: NormalizedAgendaItem[] = DEFAULT_AGENDA.map((item) => ({
  id: item.id,
  title: item.title,
  personaId: item.personaId as 'ceo' | 'cfo' | 'cmo',
  dependsOn: item.dependsOn ?? null,
}));

router.post(
  '/board-meeting',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const userId = req.clerkId!;
    const autoFinishStream =
      process.env.NODE_ENV === 'test' && req.header('x-test-auto-finish') === 'true';

    let streamStarted = false;
    let streamEnded = false;
    const prisma = createTenantClient({ tenantId, userId });

    const cleanup = async (options: { terminateStream?: boolean } = {}) => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      await prisma.$disconnect();
      if (options.terminateStream && streamStarted) {
        streamEnded = true;
        res.end();
      }
    };

    let pollTimer: NodeJS.Timeout | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      const parsed = startMeetingSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_AGENDA',
            message: 'Invalid board meeting configuration',
            details: parsed.error.flatten(),
          },
        });
      }

      const agendaVersion = parsed.data.agendaVersion ?? 1;
      const normalizedAgenda = normalizeAgenda(parsed.data.agenda);
      const agendaDisplay = agendaTemplateToDisplay(normalizedAgenda);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      streamStarted = true;

      const sendEvent = (type: string, data: unknown) => {
        if (streamEnded || res.writableEnded) {
          return;
        }
        const payload = {
          type,
          data,
          timestamp: new Date().toISOString(),
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      heartbeatTimer = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15000);

      const meeting = await prisma.boardMeeting.create({
        data: {
          tenantId,
          agenda: toInputJson(agendaDisplay),
          agendaVersion,
          metadata: toInputJson({
            status: 'queued',
            requestedBy: userId,
          }),
        },
      });

      if (autoFinishStream) {
        queueMicrotask(() => {
          void cleanup({ terminateStream: true }).catch((error: unknown) => {
            apiLogger.warn('Failed to auto-finish board meeting stream during tests', {
              error: error instanceof Error ? error.message : 'Unknown error',
              meetingId: meeting.id,
              tenantId,
            });
          });
        });
      }

      apiLogger.info('Board meeting initialized', {
        meetingId: meeting.id,
        tenantId,
        agendaVersion,
        agendaSections: normalizedAgenda.length,
      });

      agendaDisplay.forEach((section) => {
        sendEvent('agenda', {
          meetingId: meeting.id,
          sectionId: section.id,
          title: section.title,
          personaId: section.personaId,
          status: section.status,
        });
      });

      const queueJob = await enqueueBoardMeeting(
        {
          tenantId,
          meetingId: meeting.id,
          userId,
          agenda: normalizedAgenda,
          agendaVersion,
          triggeredBy: userId,
        },
        { removeOnComplete: 50 }
      );

      const personaNameLookup = new Map<string, string>();

      const agendaStatus = new Map<string, string>(
        agendaDisplay.map((section) => [section.id, section.status ?? 'pending'])
      );
      let lastPersonaSequence = 0;
      const streamedActionItems = new Set<string>();
      let summarySent = false;
      let metricsSent = false;
      let completedNotified = false;
      let pollInFlight = false;

      const poll = async () => {
        if (pollInFlight) return;
        pollInFlight = true;
        try {
          const [meetingRecord, personaTurns, newActionItems, jobStatus] = await Promise.all([
            prisma.boardMeeting.findUnique({
              where: { id: meeting.id },
              select: {
                id: true,
                agenda: true,
                metadata: true,
                outcomeSummary: true,
                tokenUsage: true,
                endedAt: true,
                startedAt: true,
              },
            }),
            prisma.boardPersonaTurn.findMany({
              where: { meetingId: meeting.id, sequence: { gt: lastPersonaSequence } },
              orderBy: { sequence: 'asc' },
            }),
            prisma.boardActionItem.findMany({
              where: {
                meetingId: meeting.id,
                id: { notIn: Array.from(streamedActionItems) },
              },
              orderBy: { createdAt: 'asc' },
              include: {
                assignee: {
                  include: {
                    user: true,
                  },
                },
              },
            }),
            getJobStatus(QUEUE_NAMES.BOARD_MEETING, queueJob.jobId).catch(() => null),
          ]);

          if (!meetingRecord) {
            throw new Error('Board meeting record no longer available');
          }

          const agendaData = Array.isArray(meetingRecord.agenda)
            ? (meetingRecord.agenda as unknown as NormalizedAgendaItem[])
            : [];

          for (const section of agendaData) {
            const previous = agendaStatus.get(section.id);
            const statusCandidate = section as NormalizedAgendaItem & { status?: string };
            const current = typeof statusCandidate.status === 'string' ? statusCandidate.status : 'pending';
            if (current !== previous) {
              agendaStatus.set(section.id, current);
              sendEvent('agenda', {
                meetingId: meeting.id,
                sectionId: section.id,
                title: section.title,
                personaId: section.personaId,
                status: current,
              });
            }
          }

          for (const turn of personaTurns) {
            lastPersonaSequence = Math.max(lastPersonaSequence, turn.sequence);

            if (!personaNameLookup.has(turn.persona)) {
              const persona = getPersonaById(turn.persona);
              personaNameLookup.set(turn.persona, persona?.name ?? turn.persona.toUpperCase());
            }

            const metricsRecord = turn.metrics
              ? parseJsonRecord(turn.metrics)
              : null;
            const cachedParsed = metricsRecord?.parsed as PersonaPayload | undefined;
            const parsed = cachedParsed ?? parsePersonaPayload(turn.content);

            sendEvent('persona-response', {
              meetingId: meeting.id,
              personaId: turn.persona,
              personaName: personaNameLookup.get(turn.persona),
              sequence: turn.sequence,
              summary: parsed.summary,
              risks: parsed.risks,
              opportunities: parsed.opportunities,
              recommendations: parsed.recommendations,
              metrics: parsed.metrics ?? null,
              rawContent: turn.content,
              createdAt: turn.createdAt.toISOString(),
            });
          }

          if (newActionItems.length) {
            newActionItems.forEach((item: (typeof newActionItems)[number]) => streamedActionItems.add(item.id));
            const enriched = newActionItems.map((item: (typeof newActionItems)[number]) =>
              enrichActionItemWithAssignee(
                mapBoardActionItemRecord(item),
                item.assignee
              )
            );

            enriched.forEach((item: (typeof enriched)[number]) => {
              sendEvent('action-item', {
                meetingId: meeting.id,
                item,
              });
            });
          }

          const metadataRecord = meetingRecord.metadata
            ? parseJsonRecord(meetingRecord.metadata)
            : null;
          if (!summarySent && typeof metadataRecord?.summary === 'string') {
            sendEvent('summary', {
              meetingId: meeting.id,
              summary: metadataRecord.summary,
            });
            summarySent = true;
          }

          if (!metricsSent && metadataRecord?.metrics) {
            sendEvent('metrics', {
              meetingId: meeting.id,
              metrics: metadataRecord.metrics,
              tokenUsage: meetingRecord.tokenUsage,
            });
            metricsSent = true;
          }

          if (jobStatus && jobStatus.state === 'failed') {
            sendEvent('error', {
              meetingId: meeting.id,
              message: jobStatus.failedReason || 'Board meeting orchestration failed',
            });
            await cleanup({ terminateStream: true });
            return;
          }

          if (meetingRecord.endedAt && !completedNotified) {
            sendEvent('completed', {
              meetingId: meeting.id,
              endedAt: meetingRecord.endedAt.toISOString(),
            });
            completedNotified = true;
            await cleanup({ terminateStream: true });
          }
        } catch (error) {
          apiLogger.error('Error polling board meeting state', {
            error: error instanceof Error ? error.message : 'Unknown error',
            meetingId: meeting.id,
            tenantId,
          });
          sendEvent('error', {
            meetingId: meeting.id,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
          await cleanup({ terminateStream: true });
        } finally {
          pollInFlight = false;
        }
      };

      pollTimer = setInterval(poll, 1500);
      void poll();

      req.on('close', async () => {
        sseLogger.info('Board meeting stream closed by client', {
          meetingId: meeting.id,
          tenantId,
        });
        streamEnded = true;
        await cleanup();
      });
    } catch (error) {
      apiLogger.error('Error in board meeting stream', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        tenantId,
        userId,
      });

      if (!streamStarted) {
        return res.status(500).json({
          error: {
            code: 'BOARD_MEETING_ERROR',
            message: 'Failed to start board meeting stream',
          },
        });
      }

      res.write(`data: ${JSON.stringify({
        type: 'error',
        data: {
          meetingId: null,
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date().toISOString(),
      })}\n\n`);
      await cleanup({ terminateStream: true });
    }
  }
);

function normalizeAgenda(
  sections?: Array<{
    id?: string;
    title: string;
    personaId: 'ceo' | 'cfo' | 'cmo';
    dependsOn?: string | null;
  }>
): NormalizedAgendaItem[] {
  if (!sections || sections.length === 0) {
  return DEFAULT_NORMALIZED_AGENDA.map((section) => ({ ...section }));
  }

  return sections.map((section, index) => ({
    id: section.id ?? `agenda-${index}-${randomUUID().slice(0, 8)}`,
    title: section.title,
    personaId: section.personaId,
    dependsOn: section.dependsOn ?? null,
  }));
}

export default router;
