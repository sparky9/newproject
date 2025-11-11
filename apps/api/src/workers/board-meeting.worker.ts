import { Worker, Job } from 'bullmq';
import { createTenantClient } from '@ocsuite/db';
import {
  QUEUE_NAMES,
  BoardMeetingJobData,
  DLQJobData,
  getRedisConnection,
  boardMeetingDLQ,
} from '../queue/index.js';
import { config } from '../config/index.js';
import { workerLogger, createContextLogger } from '../utils/logger.js';
import { instrumentWorker } from '../observability/worker-metrics.js';
import { incrementJobCompletion, incrementJobFailure } from '../utils/metrics.js';
import { toInputJson, parseJsonRecord } from '../utils/json.js';
import {
  loadBoardMeetingContext,
  agendaToSummary,
  agendaTemplateToDisplay,
  parsePersonaPayload,
  buildPersonaAnalysis,
  buildMeetingSummary,
  buildMeetingMetrics,
  isPersonaId,
  type PersonaId,
  type AgendaTemplateItem,
} from '../services/board-meeting.js';
import {
  buildPersonaPrompt as buildBoardPersonaPrompt,
  enforceContentFilter,
} from '../services/persona-prompts.js';
import {
  streamCompletion,
  estimateMessagesTokens,
  estimateTokens,
} from '../services/llm/fireworks-client.js';
import type {
  BoardMeetingAgendaItem,
  BoardMeetingAgendaStatus,
  BoardPersonaAnalysis,
  BoardActionStatus,
} from '@ocsuite/types';

interface BoardMeetingProgress {
  phase: 'initializing' | 'context' | 'persona' | 'summary' | 'completed';
  percentage: number;
  message: string;
  personaId?: string;
  sequence?: number;
}

interface BoardMeetingResult {
  success: boolean;
  meetingId: string;
  personaCount: number;
  actionItemCount: number;
  summary: string;
  endedAt: string;
}

const PERSONA_RESPONSE_INSTRUCTION =
  'Provide your analysis now following the JSON schema. Do not include any markdown or commentary outside the JSON.';

const TASK_PRIORITY_MAP: Record<string, string> = {
  low: 'low',
  medium: 'normal',
  high: 'high',
  urgent: 'urgent',
};

function mapTaskPriority(value?: string | null): 'low' | 'normal' | 'high' | 'urgent' {
  if (!value) return 'normal';
  const key = value.toLowerCase();
  if (TASK_PRIORITY_MAP[key]) {
    return TASK_PRIORITY_MAP[key] as 'low' | 'normal' | 'high' | 'urgent';
  }
  return 'normal';
}

const DEFAULT_PERSONA_ID: PersonaId = 'ceo';

function normalizeAgendaSections(sections: BoardMeetingJobData['agenda']): AgendaTemplateItem[] {
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    personaId: isPersonaId(section.personaId) ? section.personaId : DEFAULT_PERSONA_ID,
    dependsOn: section.dependsOn ?? null,
  }));
}

const toOptionalPersonaId = (value: unknown): PersonaId | undefined =>
  typeof value === 'string' && isPersonaId(value) ? value : undefined;

async function processBoardMeeting(job: Job<BoardMeetingJobData>): Promise<BoardMeetingResult> {
  const { tenantId, meetingId, userId, agenda: rawAgenda, agendaVersion } = job.data;
  const agenda = normalizeAgendaSections(rawAgenda);
  const totalAgendaSections = agenda.length;
  const logger = createContextLogger('board-meeting-worker', {
    jobId: job.id,
    tenantId,
    meetingId,
  });

  logger.info('Starting board meeting orchestration', {
    agendaVersion,
    agendaSections: totalAgendaSections,
  });

  await job.updateProgress({
    phase: 'initializing',
    percentage: 0,
    message: 'Initializing board meeting orchestration',
  } as BoardMeetingProgress);

  const db = createTenantClient({ tenantId, userId });

  try {
    const meeting = await db.boardMeeting.findUnique({
      where: { id: meetingId },
    });

    if (!meeting) {
      throw new Error(`Board meeting ${meetingId} not found for tenant ${tenantId}`);
    }

    const storedAgenda = deserializeAgenda(meeting.agenda);
    let agendaState: BoardMeetingAgendaItem[] = storedAgenda.length
      ? storedAgenda
      : agendaTemplateToDisplay(agenda);

    agendaState = agendaState.map((item) => ({
      ...item,
      status: item.status ?? 'pending',
    }));

    const startedAt = meeting.startedAt ?? new Date();

    await job.updateProgress({
      phase: 'context',
      percentage: 10,
      message: 'Loading meeting context',
    } as BoardMeetingProgress);

    const context = await loadBoardMeetingContext(db, tenantId);
    const agendaSummary = agendaToSummary(agenda);

    const personaAnalyses: BoardPersonaAnalysis[] = [];
    const personaTokens: Record<string, { input: number; output: number; total: number }> = {};
    const personaLatency: Record<string, number> = {};

    let agendaIndex = 0;
    for (const section of agenda) {
      agendaIndex += 1;
      const personaStart = Date.now();

      agendaState = await updateAgendaStatus(db, meetingId, agendaState, section.id, 'in_progress');

      await job.updateProgress({
        phase: 'persona',
        percentage: 10 + (agendaIndex - 1) * (70 / Math.max(totalAgendaSections, 1)),
        message: `Collecting ${section.personaId.toUpperCase()} perspective`,
        personaId: section.personaId,
        sequence: agendaIndex,
      } as BoardMeetingProgress);

      const promptContext = {
        tenantId,
        agendaSummary,
        businessProfile: context.businessProfile,
        latestInsights: context.latestInsights,
        analyticsSnapshots: context.analyticsSnapshots,
        existingActionItems: context.existingActionItems,
        recentWins: context.recentWins,
        personaQuestions: context.personaQuestions[section.personaId] ?? [],
        metricsSummary: context.metricsSummary,
      };

      const promptResult = buildBoardPersonaPrompt(section.personaId, promptContext);
      const messages = [
        { role: 'system' as const, content: promptResult.prompt },
        { role: 'user' as const, content: PERSONA_RESPONSE_INSTRUCTION },
      ];

      let response = '';

      for await (const chunk of streamCompletion({
        messages,
        tenantId,
        userId,
        maxTokens: promptResult.maxTokens,
      })) {
        if (chunk.done) continue;
        response += chunk.content;
      }

      const sanitized = enforceContentFilter(response.trim());
      const parsed = parsePersonaPayload(sanitized);
      const analysis = buildPersonaAnalysis(
        section.personaId,
        promptResult.persona.name,
        parsed,
        agendaIndex,
        sanitized
      );

      personaAnalyses.push(analysis);

      const inputTokens = estimateMessagesTokens(messages);
      const outputTokens = estimateTokens(sanitized);
      personaTokens[section.personaId] = {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      };

      personaLatency[section.personaId] = Date.now() - personaStart;

      await db.boardPersonaTurn.create({
        data: {
          meetingId,
          tenantId,
          persona: section.personaId,
          role: section.personaId,
          content: sanitized,
          metrics: toInputJson({
            tokens: personaTokens[section.personaId],
            parsed,
          }),
          sequence: agendaIndex,
          streamedAt: new Date(),
        },
      });

      if (parsed.recommendations.length) {
        for (const recommendation of parsed.recommendations) {
          await db.boardActionItem.create({
            data: {
              meetingId,
              tenantId,
              title: recommendation.title,
              description: recommendation.rationale ?? null,
              status: 'open',
              priority: mapTaskPriority(recommendation.priority),
              metadata: toInputJson({
                personaId: section.personaId,
                ownerHint: recommendation.ownerHint,
                dueDateHint: recommendation.dueDateHint,
              }),
            },
          });
        }
      }

      agendaState = await updateAgendaStatus(db, meetingId, agendaState, section.id, 'completed');
    }

    await job.updateProgress({
      phase: 'summary',
      percentage: 85,
      message: 'Synthesizing board meeting summary',
    } as BoardMeetingProgress);

    const allActionItems = await db.boardActionItem.findMany({
      where: { meetingId, tenantId },
    });

    const endedAt = new Date();
  const summary = buildMeetingSummary(personaAnalyses);
    const metrics = buildMeetingMetrics(
      new Date(startedAt),
      endedAt,
      personaTokens,
      allActionItems.map((item) => ({
        status: item.status as BoardActionStatus,
        personaId: (() => {
          if (!item.metadata) {
            return undefined;
          }
          const record = parseJsonRecord(item.metadata);
          return toOptionalPersonaId(record.personaId);
        })(),
      })),
      personaLatency
    );

    await db.boardMeeting.update({
      where: { id: meetingId },
      data: {
        agenda: toInputJson(agendaState),
        outcomeSummary: summary.narrative,
        tokenUsage: toInputJson(personaTokens),
        metadata: toInputJson({
          summary,
          metrics,
          personaOrder: agenda.map((item) => item.personaId),
          agendaVersion,
        }),
        endedAt,
      },
    });

    await job.updateProgress({
      phase: 'completed',
      percentage: 100,
      message: 'Board meeting orchestration completed',
    } as BoardMeetingProgress);

    logger.info('Board meeting orchestration finished', {
      meetingId,
      personaCount: personaAnalyses.length,
      actionItems: allActionItems.length,
    });

    return {
      success: true,
      meetingId,
      personaCount: personaAnalyses.length,
      actionItemCount: allActionItems.length,
      summary: summary.narrative,
      endedAt: endedAt.toISOString(),
    };
  } catch (error) {
    logger.error('Board meeting orchestration failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    throw error;
  } finally {
    await db.$disconnect();
  }
}

async function updateAgendaStatus(
  db: ReturnType<typeof createTenantClient>,
  meetingId: string,
  agenda: BoardMeetingAgendaItem[],
  sectionId: string,
  status: BoardMeetingAgendaStatus
): Promise<BoardMeetingAgendaItem[]> {
  const nextAgenda = agenda.map((item) =>
    item.id === sectionId ? { ...item, status } : item
  );

  await db.boardMeeting.update({
    where: { id: meetingId },
    data: {
      agenda: toInputJson(nextAgenda),
    },
  });

  return nextAgenda;
}

function deserializeAgenda(value: unknown): BoardMeetingAgendaItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'object' && entry !== null ? entry : null))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const dependsOnValue = entry.dependsOn;
      const dependsOn =
        typeof dependsOnValue === 'string'
          ? dependsOnValue
          : dependsOnValue === null || typeof dependsOnValue === 'undefined'
            ? null
            : String(dependsOnValue);

      const statusValue = entry.status;
      const status =
        typeof statusValue === 'string'
          ? (statusValue as BoardMeetingAgendaStatus)
          : undefined;

      return {
        id: typeof entry.id === 'string' ? entry.id : String(entry.id ?? ''),
        title: typeof entry.title === 'string' ? entry.title : String(entry.title ?? ''),
        personaId: typeof entry.personaId === 'string' ? entry.personaId : 'ceo',
        dependsOn,
        status,
      };
    });
}

async function handleJobFailure(job: Job<BoardMeetingJobData>, error: Error): Promise<void> {
  const logger = createContextLogger('board-meeting-worker', {
    jobId: job.id,
    tenantId: job.data.tenantId,
    meetingId: job.data.meetingId,
  });

  try {
    await boardMeetingDLQ.add('board-meeting-failed', {
      originalQueue: QUEUE_NAMES.BOARD_MEETING,
      originalJobId: job.id!,
      tenantId: job.data.tenantId,
      failedData: job.data,
      failureReason: error.message,
      failedAt: new Date().toISOString(),
      attemptsMade: job.attemptsMade,
    } satisfies DLQJobData);

    logger.info('Board meeting job moved to DLQ');
  } catch (dlqError) {
    logger.error('Failed to enqueue board meeting job in DLQ', {
      error: dlqError instanceof Error ? dlqError.message : 'Unknown error',
    });
  }
}

export const createBoardMeetingWorker = (): Worker<BoardMeetingJobData> => {
  const worker = new Worker<BoardMeetingJobData>(
    QUEUE_NAMES.BOARD_MEETING,
    processBoardMeeting,
    {
      connection: getRedisConnection(),
      concurrency: config.queueBoardMeetingConcurrency ?? 1,
      removeOnComplete: { count: config.queueRemoveOnComplete },
      removeOnFail: { count: config.queueRemoveOnFail },
    }
  );

  worker.on('completed', (job, result: BoardMeetingResult) => {
    incrementJobCompletion(QUEUE_NAMES.BOARD_MEETING);
    workerLogger.info('Board meeting job completed', {
      jobId: job.id,
      tenantId: job.data.tenantId,
      meetingId: job.data.meetingId,
      personaCount: result.personaCount,
      actionItemCount: result.actionItemCount,
    });
  });

  worker.on('failed', async (job, error) => {
    if (!job) return;
    incrementJobFailure(QUEUE_NAMES.BOARD_MEETING);
    workerLogger.error('Board meeting job failed', {
      jobId: job.id,
      tenantId: job.data.tenantId,
      meetingId: job.data.meetingId,
      error: error.message,
      attemptsMade: job.attemptsMade,
    });

    if (job.attemptsMade >= config.queueMaxRetries) {
      await handleJobFailure(job, error as Error);
    }
  });

  worker.on('error', (error) => {
    workerLogger.error('Board meeting worker error', {
      error: error.message,
    });
  });

  worker.on('stalled', (jobId) => {
    workerLogger.warn('Board meeting job stalled', { jobId });
  });

  workerLogger.info('Board meeting worker created', {
    concurrency: config.queueBoardMeetingConcurrency ?? 1,
  });

  return instrumentWorker(worker);
};
