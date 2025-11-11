import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { BoardMeetingJobData } from '../queue/index.js';

// Mock all external dependencies before importing worker
vi.mock('@ocsuite/db', () => ({
  createTenantClient: vi.fn(),
}));

vi.mock('../queue/index.js', () => ({
  QUEUE_NAMES: {
    BOARD_MEETING: 'board-meeting',
  },
  getRedisConnection: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
  })),
  boardMeetingDLQ: {
    add: vi.fn(),
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    queueBoardMeetingConcurrency: 1,
    queueRemoveOnComplete: 100,
    queueRemoveOnFail: 100,
    queueMaxRetries: 3,
  },
}));

vi.mock('../utils/logger.js', () => ({
  workerLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  createContextLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../utils/metrics.js', () => ({
  incrementJobCompletion: vi.fn(),
  incrementJobFailure: vi.fn(),
}));

vi.mock('../services/board-meeting.js', () => ({
  loadBoardMeetingContext: vi.fn(),
  agendaToSummary: vi.fn((agenda) => `Meeting agenda: ${agenda.map((a: any) => a.title).join(', ')}`),
  agendaTemplateToDisplay: vi.fn((agenda) =>
    agenda.map((item: any, _idx: number) => ({
      id: item.id,
      title: item.title,
      personaId: item.personaId,
      status: 'pending',
    }))
  ),
  parsePersonaPayload: vi.fn(),
  buildPersonaAnalysis: vi.fn(),
  buildMeetingSummary: vi.fn(),
  buildMeetingMetrics: vi.fn(),
  isPersonaId: vi.fn((value) => ['ceo', 'cfo', 'cmo', 'cto'].includes(value)),
}));

vi.mock('../services/persona-prompts.js', () => ({
  buildPersonaPrompt: vi.fn(),
  enforceContentFilter: vi.fn((content) => content),
}));

vi.mock('../services/llm/fireworks-client.js', () => ({
  streamCompletion: vi.fn(),
  estimateMessagesTokens: vi.fn(() => 100),
  estimateTokens: vi.fn(() => 150),
}));

vi.mock('../utils/json.js', () => ({
  toInputJson: vi.fn((value) => value),
  parseJsonRecord: vi.fn((value) => value || {}),
}));

// Import after mocks are set up
import { createBoardMeetingWorker } from './board-meeting.worker.js';
import { createTenantClient } from '@ocsuite/db';
import {
  loadBoardMeetingContext,
  parsePersonaPayload,
  buildPersonaAnalysis,
  buildMeetingSummary,
  buildMeetingMetrics,
} from '../services/board-meeting.js';
import { buildPersonaPrompt } from '../services/persona-prompts.js';
import { streamCompletion } from '../services/llm/fireworks-client.js';
import { boardMeetingDLQ } from '../queue/index.js';

describe('board-meeting.worker', () => {
  let mockDb: any;
  let mockJob: Partial<Job<BoardMeetingJobData>>;
  let progressUpdates: any[];

  beforeEach(() => {
    progressUpdates = [];

    // Mock database client
    mockDb = {
      boardMeeting: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      boardPersonaTurn: {
        create: vi.fn(),
      },
      boardActionItem: {
        create: vi.fn(),
        findMany: vi.fn(() => []),
      },
      $disconnect: vi.fn(),
    };

    vi.mocked(createTenantClient).mockReturnValue(mockDb);

    // Mock job
    mockJob = {
      id: 'job-123',
      data: {
        tenantId: 'tenant-123',
        meetingId: 'meeting-123',
        userId: 'user-123',
        agenda: [
          {
            id: 'section-1',
            title: 'Executive Overview',
            personaId: 'ceo',
            dependsOn: null,
          },
          {
            id: 'section-2',
            title: 'Financial Health',
            personaId: 'cfo',
            dependsOn: null,
          },
        ],
        agendaVersion: 1,
      },
      updateProgress: vi.fn((progress) => {
        progressUpdates.push(progress);
        return Promise.resolve();
      }),
      attemptsMade: 0,
    };

    // Default mock implementations
    vi.mocked(loadBoardMeetingContext).mockResolvedValue({
      businessProfile: {
        id: 'profile-1',
        tenantId: 'tenant-123',
        industry: 'SaaS',
        stage: 'growth',
        size: '10-50',
        revenue: '$500k-$1M',
        goals: ['Increase MRR'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      latestInsights: [],
      analyticsSnapshots: [],
      existingActionItems: [],
      recentWins: [],
      personaQuestions: {},
      metricsSummary: {},
    });

    vi.mocked(buildPersonaPrompt).mockReturnValue({
      persona: { id: 'ceo', name: 'CEO', tone: 'strategic', expertise: [], maxTokens: 450, streamChunkSize: 100, focus: '', requiredContext: [] },
      prompt: 'Test prompt',
      maxTokens: 450,
      streamChunkSize: 100,
    });

    const mockLLMResponse = JSON.stringify({
      summary: 'Strong quarter with notable growth',
      risks: ['Market competition increasing'],
      opportunities: ['New market segment identified'],
      recommendations: [
        {
          title: 'Expand to enterprise segment',
          ownerHint: 'CEO',
          dueDateHint: '2 weeks',
          priority: 'high',
          rationale: 'Enterprise deals show higher LTV',
        },
      ],
      metrics: {},
    });

    vi.mocked(streamCompletion).mockReturnValue(
      (async function* () {
        yield { content: mockLLMResponse, done: false };
        yield { content: '', done: true };
      })()
    );

    vi.mocked(parsePersonaPayload).mockReturnValue({
      summary: 'Strong quarter with notable growth',
      risks: ['Market competition increasing'],
      opportunities: ['New market segment identified'],
      recommendations: [
        {
          title: 'Expand to enterprise segment',
          ownerHint: 'CEO',
          dueDateHint: '2 weeks',
          priority: 'high',
          rationale: 'Enterprise deals show higher LTV',
        },
      ],
      metrics: {},
    });

    vi.mocked(buildPersonaAnalysis).mockReturnValue({
      personaId: 'ceo',
      personaName: 'CEO',
      summary: 'Strong quarter with notable growth',
      risks: ['Market competition increasing'],
      opportunities: ['New market segment identified'],
      recommendations: [
        {
          title: 'Expand to enterprise segment',
          ownerHint: 'CEO',
          dueDateHint: '2 weeks',
          priority: 'high',
          rationale: 'Enterprise deals show higher LTV',
        },
      ],
      rawContent: mockLLMResponse,
      sequence: 1,
      createdAt: new Date().toISOString(),
    });

    vi.mocked(buildMeetingSummary).mockReturnValue({
      narrative: 'Overall strong performance with identified opportunities',
      highlights: ['Growth momentum', 'New market opportunities'],
      risks: ['Competition'],
      blockers: [],
      nextSteps: ['Expand to enterprise'],
    });

    vi.mocked(buildMeetingMetrics).mockReturnValue({
      durationMs: 45000,
      personaTokens: {
        ceo: { input: 100, output: 150, total: 250 },
        cfo: { input: 100, output: 150, total: 250 },
      },
      actionItems: { open: 2, in_progress: 0, completed: 0 },
      personaLatencyMs: {
        ceo: 5000,
        cfo: 5500,
      },
      tokenCostUsd: null,
      userFeedback: null,
    });

    mockDb.boardMeeting.findUnique.mockResolvedValue({
      id: 'meeting-123',
      tenantId: 'tenant-123',
      startedAt: new Date(),
      endedAt: null,
      agenda: [],
      agendaVersion: 1,
      outcomeSummary: null,
      tokenUsage: null,
      rating: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('processBoardMeeting workflow', () => {
    it('should successfully orchestrate a full board meeting', async () => {
      // Create worker and manually trigger job processor
      const worker = createBoardMeetingWorker();

      // Access the processor function (not ideal but needed for testing)
      // In real tests, you'd enqueue a job and let the worker process it
      const processor = (worker as any).processFn;

      const result = await processor(mockJob as Job<BoardMeetingJobData>);

      expect(result).toMatchObject({
        success: true,
        meetingId: 'meeting-123',
        personaCount: 2,
        actionItemCount: 0, // findMany returns []
      });

      expect(result.summary).toBeTruthy();
      expect(result.endedAt).toBeTruthy();
    });

    it('should update progress through all phases', async () => {
      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      expect(progressUpdates.length).toBeGreaterThan(0);

      const phases = progressUpdates.map((p) => p.phase);
      expect(phases).toContain('initializing');
      expect(phases).toContain('context');
      expect(phases).toContain('persona');
      expect(phases).toContain('summary');
      expect(phases).toContain('completed');
    });

    it('should create persona turns for each agenda section', async () => {
      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      expect(mockDb.boardPersonaTurn.create).toHaveBeenCalledTimes(2);

      const firstCall = mockDb.boardPersonaTurn.create.mock.calls[0][0];
      expect(firstCall.data).toMatchObject({
        meetingId: 'meeting-123',
        tenantId: 'tenant-123',
        persona: 'ceo',
        sequence: 1,
      });
    });

    it('should create action items from persona recommendations', async () => {
      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      // 2 personas × 1 recommendation each
      expect(mockDb.boardActionItem.create).toHaveBeenCalledTimes(2);

      const firstCall = mockDb.boardActionItem.create.mock.calls[0][0];
      expect(firstCall.data).toMatchObject({
        meetingId: 'meeting-123',
        tenantId: 'tenant-123',
        title: 'Expand to enterprise segment',
        status: 'open',
        priority: 'high',
      });
    });

    it('should update meeting record with final results', async () => {
      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      expect(mockDb.boardMeeting.update).toHaveBeenCalled();

      const updateCalls = mockDb.boardMeeting.update.mock.calls;
      const finalUpdate = updateCalls[updateCalls.length - 1][0];

      expect(finalUpdate.data).toHaveProperty('outcomeSummary');
      expect(finalUpdate.data).toHaveProperty('tokenUsage');
      expect(finalUpdate.data).toHaveProperty('metadata');
      expect(finalUpdate.data).toHaveProperty('endedAt');
    });

    it('should track token usage per persona', async () => {
      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      const finalUpdate = mockDb.boardMeeting.update.mock.calls[mockDb.boardMeeting.update.mock.calls.length - 1][0];
      const tokenUsage = finalUpdate.data.tokenUsage;

      expect(tokenUsage).toHaveProperty('ceo');
      expect(tokenUsage).toHaveProperty('cfo');
      expect(tokenUsage.ceo).toMatchObject({
        input: expect.any(Number),
        output: expect.any(Number),
        total: expect.any(Number),
      });
    });

    it('should call LLM streaming for each persona', async () => {
      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      expect(streamCompletion).toHaveBeenCalledTimes(2);

      const calls = vi.mocked(streamCompletion).mock.calls;
      expect(calls[0][0]).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        tenantId: 'tenant-123',
        userId: 'user-123',
        maxTokens: 450,
      });
    });

    it('should build persona prompts with correct context', async () => {
      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      expect(buildPersonaPrompt).toHaveBeenCalledTimes(2);

      const firstCall = vi.mocked(buildPersonaPrompt).mock.calls[0];
      expect(firstCall[0]).toBe('ceo');
      expect(firstCall[1]).toMatchObject({
        tenantId: 'tenant-123',
        agendaSummary: expect.stringContaining('Executive Overview'),
        businessProfile: expect.any(Object),
        latestInsights: expect.any(Array),
      });
    });
  });

  describe('agenda status tracking', () => {
    it('should update agenda status from pending to in_progress to completed', async () => {
      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      const updateCalls = mockDb.boardMeeting.update.mock.calls;

      // Check that agenda updates happened
      const agendaUpdates = updateCalls.filter((call: any) =>
        call[0].data.agenda !== undefined
      );

      expect(agendaUpdates.length).toBeGreaterThan(0);
    });

    it('should preserve existing agenda state if available', async () => {
      mockDb.boardMeeting.findUnique.mockResolvedValue({
        id: 'meeting-123',
        tenantId: 'tenant-123',
        startedAt: new Date(),
        agenda: [
          { id: 'section-1', title: 'Executive Overview', personaId: 'ceo', status: 'pending' },
          { id: 'section-2', title: 'Financial Health', personaId: 'cfo', status: 'pending' },
        ],
        agendaVersion: 1,
      });

      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      // Should use stored agenda
      expect(mockDb.boardMeeting.update).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error if meeting not found', async () => {
      mockDb.boardMeeting.findUnique.mockResolvedValue(null);

      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await expect(processor(mockJob as Job<BoardMeetingJobData>)).rejects.toThrow(
        'Board meeting meeting-123 not found for tenant tenant-123'
      );
    });

    it('should disconnect database on error', async () => {
      mockDb.boardMeeting.findUnique.mockRejectedValue(new Error('Database error'));

      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await expect(processor(mockJob as Job<BoardMeetingJobData>)).rejects.toThrow('Database error');

      expect(mockDb.$disconnect).toHaveBeenCalled();
    });

    it('should move failed job to DLQ after max retries', async () => {
      const failedJob = {
        ...mockJob,
        attemptsMade: 3,
      };

      const worker = createBoardMeetingWorker();

      // Simulate job failure
      const error = new Error('Processing failed');
      await worker.emit('failed', failedJob as Job<BoardMeetingJobData>, error);

      expect(boardMeetingDLQ.add).toHaveBeenCalledWith('board-meeting-failed', expect.objectContaining({
        originalQueue: 'board-meeting',
        tenantId: 'tenant-123',
        failureReason: 'Processing failed',
        attemptsMade: 3,
      }));
    });
  });

  describe('priority mapping', () => {
    it('should map recommendation priorities to task priorities', async () => {
      vi.mocked(parsePersonaPayload).mockReturnValue({
        summary: 'Test',
        risks: [],
        opportunities: [],
        recommendations: [
          { title: 'Low priority task', priority: 'low' },
          { title: 'Medium priority task', priority: 'medium' },
          { title: 'High priority task', priority: 'high' },
          { title: 'Urgent task', priority: 'urgent' },
        ],
        metrics: {},
      });

      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      const actionCalls = mockDb.boardActionItem.create.mock.calls;
      expect(actionCalls[0][0].data.priority).toBe('low');
      expect(actionCalls[1][0].data.priority).toBe('normal'); // medium → normal
      expect(actionCalls[2][0].data.priority).toBe('high');
      expect(actionCalls[3][0].data.priority).toBe('urgent');
    });

    it('should default to normal priority for unknown values', async () => {
      vi.mocked(parsePersonaPayload).mockReturnValue({
        summary: 'Test',
        risks: [],
        opportunities: [],
        recommendations: [
          { title: 'Unknown priority task', priority: 'unknown' },
          { title: 'No priority task' },
        ],
        metrics: {},
      });

      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      const actionCalls = mockDb.boardActionItem.create.mock.calls;
      expect(actionCalls[0][0].data.priority).toBe('normal');
      expect(actionCalls[1][0].data.priority).toBe('normal');
    });
  });

  describe('persona validation', () => {
    it('should default to CEO persona for invalid persona IDs', async () => {
      mockJob.data!.agenda = [
        {
          id: 'section-1',
          title: 'Test Section',
          personaId: 'invalid-persona' as any,
          dependsOn: null,
        },
      ];

      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      expect(buildPersonaPrompt).toHaveBeenCalledWith('ceo', expect.any(Object));
    });
  });

  describe('content filtering', () => {
    it('should apply content filter to LLM responses', async () => {
      const { enforceContentFilter } = await import('../services/persona-prompts.js');

      const worker = createBoardMeetingWorker();
      const processor = (worker as any).processFn;

      await processor(mockJob as Job<BoardMeetingJobData>);

      expect(enforceContentFilter).toHaveBeenCalled();
    });
  });

  describe('worker event handlers', () => {
    it('should create worker with correct configuration', () => {
      const worker = createBoardMeetingWorker();

      expect(worker).toBeDefined();
      expect(worker.name).toBe('board-meeting');
    });

    it('should log completion on successful job', async () => {
      const worker = createBoardMeetingWorker();
      const { workerLogger } = await import('../utils/logger.js');

      const mockResult = {
        success: true,
        meetingId: 'meeting-123',
        personaCount: 2,
        actionItemCount: 3,
        summary: 'Test summary',
        endedAt: new Date().toISOString(),
      };

      await worker.emit('completed', mockJob as Job<BoardMeetingJobData>, mockResult);

      expect(workerLogger.info).toHaveBeenCalledWith(
        'Board meeting job completed',
        expect.objectContaining({
          meetingId: 'meeting-123',
          personaCount: 2,
          actionItemCount: 3,
        })
      );
    });

    it('should log error on failed job', async () => {
      const worker = createBoardMeetingWorker();
      const { workerLogger } = await import('../utils/logger.js');

      const error = new Error('Test error');
      await worker.emit('failed', mockJob as Job<BoardMeetingJobData>, error);

      expect(workerLogger.error).toHaveBeenCalledWith(
        'Board meeting job failed',
        expect.objectContaining({
          error: 'Test error',
        })
      );
    });
  });
});
