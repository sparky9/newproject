import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import type {
  BoardMeetingStreamEnvelope,
  BoardMeetingAgendaItem,
  BoardActionItemRecord,
} from '@ocsuite/types';

// Mock all dependencies
vi.mock('@ocsuite/db', () => ({
  createTenantClient: vi.fn(),
}));

vi.mock('@ocsuite/module-sdk', () => ({
  getPersonaById: vi.fn((id: string) => ({
    id,
    name: id.toUpperCase(),
    tone: 'professional',
    expertise: [],
    maxTokens: 450,
    streamChunkSize: 100,
    focus: 'test',
    requiredContext: [],
  })),
}));

type MockRequest = Request & { clerkId?: string; tenantId?: string };
type DoneFn = (error?: unknown) => void;

type MockDbActionItem = Omit<BoardActionItemRecord, 'dueDate' | 'createdAt' | 'updatedAt'> & {
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

vi.mock('../middleware/auth.js', () => ({
  requireAuth: () => (req: MockRequest, _res: Response, next: NextFunction) => {
    req.clerkId = 'user-123';
    next();
  },
}));

vi.mock('../middleware/tenant.js', () => ({
  resolveTenant: () => (req: MockRequest, _res: Response, next: NextFunction) => {
    req.tenantId = 'tenant-123';
    next();
  },
}));

vi.mock('../utils/logger.js', () => ({
  apiLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  sseLogger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/board-meeting.js', () => ({
  DEFAULT_AGENDA: [
    { id: 'exec-overview', title: 'Executive Overview', personaId: 'ceo', dependsOn: null },
    { id: 'financial', title: 'Financial Health', personaId: 'cfo', dependsOn: null },
    { id: 'growth', title: 'Growth Outlook', personaId: 'cmo', dependsOn: null },
  ],
  agendaTemplateToDisplay: vi.fn((agenda: BoardMeetingAgendaItem[]) =>
    agenda.map((item: BoardMeetingAgendaItem) => ({
      ...item,
      status: 'pending',
    }))
  ),
  parsePersonaPayload: vi.fn((content: string) => {
    try {
      return JSON.parse(content);
    } catch {
      return {
        summary: 'Fallback summary',
        risks: [],
        opportunities: [],
        recommendations: [],
        metrics: {},
      };
    }
  }),
  enrichActionItemWithAssignee: vi.fn(
    (
      item: BoardActionItemRecord,
      assignee: { id: string; user?: { name: string | null; email: string | null } | null } | null
    ) => ({
      ...item,
      assignee: assignee?.user ? { name: assignee.user.name, email: assignee.user.email } : null,
    })
  ),
  mapBoardActionItemRecord: vi.fn((item: MockDbActionItem) => ({
    id: item.id,
    meetingId: item.meetingId,
    tenantId: item.tenantId,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    assigneeId: item.assigneeId,
    dueDate: item.dueDate ? item.dueDate.toISOString() : null,
    metadata: item.metadata,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  })),
}));

vi.mock('../queue/client.js', () => ({
  enqueueBoardMeeting: vi.fn(),
  getJobStatus: vi.fn(),
}));

vi.mock('../queue/index.js', () => ({
  QUEUE_NAMES: {
    BOARD_MEETING: 'board-meeting',
  },
}));

vi.mock('../utils/json.js', () => ({
  toInputJson: vi.fn((value: unknown) => value),
  parseJsonRecord: vi.fn((value: unknown) => value || {}),
}));

import { createTenantClient } from '@ocsuite/db';
import { enqueueBoardMeeting, getJobStatus } from '../queue/client.js';
import boardRoutes from './board.routes.js';

describe('board.routes SSE streaming', () => {
  let app: express.Application;

  type MockFn<Args extends unknown[] = unknown[], Return = unknown> = ReturnType<
    typeof vi.fn<Args, Return>
  >;

  interface MockTenantClient {
    boardMeeting: {
      create: MockFn<[unknown], Promise<unknown>>;
      findUnique: MockFn<[unknown], Promise<unknown>>;
      update: MockFn<[unknown], Promise<unknown>>;
    };
    boardPersonaTurn: {
      findMany: MockFn<[unknown], Promise<unknown>>;
    };
    boardActionItem: {
      findMany: MockFn<[unknown], Promise<unknown>>;
    };
    $disconnect: MockFn<[], Promise<void>>;
  }

  let mockDb: MockTenantClient;
  let meetingId: string;

  beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

    meetingId = 'meeting-test-123';

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/c-suite', boardRoutes);

    // Mock database client
    mockDb = {
      boardMeeting: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      boardPersonaTurn: {
        findMany: vi.fn(() => []),
      },
      boardActionItem: {
        findMany: vi.fn(() => []),
      },
      $disconnect: vi.fn(),
    };

    mockDb.boardMeeting.create.mockResolvedValue({
      id: meetingId,
      tenantId: 'tenant-123',
      startedAt: new Date(),
      endedAt: null,
      agenda: [],
      agendaVersion: 1,
      outcomeSummary: null,
      tokenUsage: null,
      rating: null,
      metadata: {
        status: 'queued',
        requestedBy: 'user-123',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockDb.boardMeeting.findUnique.mockResolvedValue({
      id: meetingId,
      tenantId: 'tenant-123',
      startedAt: new Date(),
      endedAt: null,
      agenda: [
        { id: 'exec-overview', title: 'Executive Overview', personaId: 'ceo', status: 'pending' },
        { id: 'financial', title: 'Financial Health', personaId: 'cfo', status: 'pending' },
        { id: 'growth', title: 'Growth Outlook', personaId: 'cmo', status: 'pending' },
      ],
      metadata: null,
      outcomeSummary: null,
      tokenUsage: null,
    });

    vi.mocked(createTenantClient).mockReturnValue(mockDb);

    vi.mocked(enqueueBoardMeeting).mockResolvedValue({
      jobId: 'job-123',
      meetingId,
    });

    vi.mocked(getJobStatus).mockResolvedValue({
      state: 'active',
      progress: { phase: 'persona', percentage: 50 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('POST /c-suite/board-meeting', () => {
    it('should return SSE headers', async () => {
      const response = await request(app)
        .post('/c-suite/board-meeting')
        .set('X-Test-Auto-Finish', 'true')
        .send({})
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.headers['cache-control']).toContain('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
    });

    it('should validate request schema and reject invalid agenda', async () => {
      const response = await request(app)
        .post('/c-suite/board-meeting')
        .set('X-Test-Auto-Finish', 'true')
        .send({
          agenda: [
            {
              title: '', // Empty title should fail validation
              personaId: 'ceo',
            },
          ],
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('INVALID_AGENDA');
    });

    it('should validate persona IDs in agenda', async () => {
      const response = await request(app)
        .post('/c-suite/board-meeting')
        .set('X-Test-Auto-Finish', 'true')
        .send({
          agenda: [
            {
              title: 'Test Section',
              personaId: 'invalid-persona', // Should fail validation
            },
          ],
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should accept valid agenda configuration', async () => {
      const response = await request(app)
        .post('/c-suite/board-meeting')
        .set('X-Test-Auto-Finish', 'true')
        .send({
          agenda: [
            {
              title: 'Custom Section',
              personaId: 'ceo',
            },
          ],
          agendaVersion: 2,
        });

      expect(response.status).toBe(200);
      expect(mockDb.boardMeeting.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agendaVersion: 2,
          }),
        })
      );
    });

    it('should use default agenda if none provided', async () => {
      await request(app)
        .post('/c-suite/board-meeting')
        .set('X-Test-Auto-Finish', 'true')
        .send({});

      expect(mockDb.boardMeeting.create).toHaveBeenCalled();
      expect(enqueueBoardMeeting).toHaveBeenCalledWith(
        expect.objectContaining({
          agenda: expect.arrayContaining([
            expect.objectContaining({ personaId: 'ceo' }),
            expect.objectContaining({ personaId: 'cfo' }),
            expect.objectContaining({ personaId: 'cmo' }),
          ]),
        }),
        expect.any(Object)
      );
    });

    it('should create board meeting record in database', async () => {
      await request(app)
        .post('/c-suite/board-meeting')
        .set('X-Test-Auto-Finish', 'true')
        .send({});

      expect(mockDb.boardMeeting.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-123',
          agendaVersion: 1,
          metadata: expect.objectContaining({
            status: 'queued',
            requestedBy: 'user-123',
          }),
        }),
      });
    });

    it('should enqueue job with correct parameters', async () => {
      await request(app)
        .post('/c-suite/board-meeting')
        .set('X-Test-Auto-Finish', 'true')
        .send({
          agendaVersion: 3,
        });

      expect(enqueueBoardMeeting).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-123',
          userId: 'user-123',
          agendaVersion: 3,
          triggeredBy: 'user-123',
        }),
        expect.objectContaining({
          removeOnComplete: 50,
        })
      );
    });
  });

  describe('SSE event payloads', () => {
    function parseSSEEvents(text: string): BoardMeetingStreamEnvelope[] {
      const events: BoardMeetingStreamEnvelope[] = [];
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          try {
            events.push(JSON.parse(jsonStr));
          } catch {
            // Skip invalid JSON
          }
        }
      }

      return events;
    }

  it('should emit agenda events with correct structure', (done: DoneFn) => {
      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);
        const agendaEvents = events.filter((e) => e.type === 'agenda');

        expect(agendaEvents.length).toBeGreaterThan(0);
        agendaEvents.forEach((event) => {
          expect(event).toMatchObject({
            type: 'agenda',
            timestamp: expect.any(String),
            data: expect.objectContaining({
              meetingId: expect.any(String),
              sectionId: expect.any(String),
              title: expect.any(String),
              personaId: expect.any(String),
              status: expect.any(String),
            }),
          });
        });

        done();
      }, 100);
    });

  it('should emit persona-response events when turns are created', (done: DoneFn) => {
      mockDb.boardPersonaTurn.findMany.mockResolvedValue([
        {
          id: 'turn-1',
          meetingId,
          tenantId: 'tenant-123',
          persona: 'ceo',
          role: 'ceo',
          content: JSON.stringify({
            summary: 'Strong quarter with growth',
            risks: ['Competition'],
            opportunities: ['New markets'],
            recommendations: [{ title: 'Expand sales team' }],
            metrics: {},
          }),
          metrics: null,
          sequence: 1,
          streamedAt: new Date(),
          createdAt: new Date(),
        },
      ]);

      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      // Trigger poll cycle
      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 50);

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);
        const personaEvents = events.filter((e) => e.type === 'persona-response');

        expect(personaEvents.length).toBeGreaterThan(0);
        const personaEvent = personaEvents[0];

        expect(personaEvent.data).toMatchObject({
          meetingId,
          personaId: 'ceo',
          personaName: expect.any(String),
          sequence: 1,
          summary: expect.any(String),
          risks: expect.any(Array),
          opportunities: expect.any(Array),
          recommendations: expect.any(Array),
          rawContent: expect.any(String),
          createdAt: expect.any(String),
        });

        done();
      }, 200);
    });

  it('should emit action-item events when action items are created', (done: DoneFn) => {
      mockDb.boardActionItem.findMany.mockResolvedValue([
        {
          id: 'action-1',
          meetingId,
          tenantId: 'tenant-123',
          title: 'Hire sales manager',
          description: 'To support growth',
          status: 'open',
          priority: 'high',
          assigneeId: null,
          assignee: null,
          dueDate: null,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 50);

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);
        const actionEvents = events.filter((e) => e.type === 'action-item');

        expect(actionEvents.length).toBeGreaterThan(0);
        const actionEvent = actionEvents[0];

        expect(actionEvent.data).toMatchObject({
          meetingId,
          item: expect.objectContaining({
            id: 'action-1',
            title: 'Hire sales manager',
            status: 'open',
            priority: 'high',
          }),
        });

        done();
      }, 200);
    });

  it('should emit summary event when metadata contains summary', (done: DoneFn) => {
      mockDb.boardMeeting.findUnique.mockResolvedValue({
        id: meetingId,
        tenantId: 'tenant-123',
        startedAt: new Date(),
        endedAt: null,
        agenda: [],
        metadata: {
          summary: 'Overall strong performance with identified opportunities',
        },
        outcomeSummary: null,
        tokenUsage: null,
      });

      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 50);

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);
        const summaryEvents = events.filter((e) => e.type === 'summary');

        expect(summaryEvents.length).toBeGreaterThan(0);
        expect(summaryEvents[0].data).toMatchObject({
          meetingId,
          summary: expect.any(String),
        });

        done();
      }, 200);
    });

  it('should emit metrics event when metadata contains metrics', (done: DoneFn) => {
      mockDb.boardMeeting.findUnique.mockResolvedValue({
        id: meetingId,
        tenantId: 'tenant-123',
        startedAt: new Date(),
        endedAt: null,
        agenda: [],
        metadata: {
          metrics: {
            durationMs: 45000,
            personaTokens: {
              ceo: { input: 100, output: 150, total: 250 },
            },
            actionItems: { open: 2, in_progress: 0, completed: 0 },
          },
        },
        outcomeSummary: null,
        tokenUsage: { ceo: { input: 100, output: 150, total: 250 } },
      });

      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 50);

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);
        const metricsEvents = events.filter((e) => e.type === 'metrics');

        expect(metricsEvents.length).toBeGreaterThan(0);
        expect(metricsEvents[0].data).toMatchObject({
          meetingId,
          metrics: expect.any(Object),
          tokenUsage: expect.any(Object),
        });

        done();
      }, 200);
    });

  it('should emit completed event when meeting ends', (done: DoneFn) => {
      const endedAt = new Date();
      mockDb.boardMeeting.findUnique.mockResolvedValue({
        id: meetingId,
        tenantId: 'tenant-123',
        startedAt: new Date(Date.now() - 45000),
        endedAt,
        agenda: [],
        metadata: {},
        outcomeSummary: 'Meeting completed successfully',
        tokenUsage: {},
      });

      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 50);

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);
        const completedEvents = events.filter((e) => e.type === 'completed');

        expect(completedEvents.length).toBeGreaterThan(0);
        expect(completedEvents[0].data).toMatchObject({
          meetingId,
          endedAt: expect.any(String),
        });

        done();
      }, 200);
    });

  it('should emit error event when job fails', (done: DoneFn) => {
      vi.mocked(getJobStatus).mockResolvedValue({
        state: 'failed',
        failedReason: 'LLM timeout',
      });

      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 50);

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);
        const errorEvents = events.filter((e) => e.type === 'error');

        expect(errorEvents.length).toBeGreaterThan(0);
        expect(errorEvents[0].data).toMatchObject({
          meetingId,
          message: expect.stringContaining('LLM timeout'),
        });

        done();
      }, 200);
    });

  it('should include timestamp in all events', (done: DoneFn) => {
      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);

        expect(events.length).toBeGreaterThan(0);
        events.forEach((event) => {
          expect(event).toHaveProperty('timestamp');
          expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });

        done();
      }, 100);
    });
  });

  describe('heartbeat mechanism', () => {
  it('should send heartbeat comments every 15 seconds', (done: DoneFn) => {
      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      // Advance time to trigger heartbeat
      setTimeout(() => {
        vi.advanceTimersByTime(15000);
      }, 50);

      setTimeout(() => {
        req.abort();
        expect(chunks).toContain(': heartbeat');
        done();
      }, 200);
    });
  });

  describe('cleanup and resource management', () => {
  it('should disconnect database on stream end', (done: DoneFn) => {
      mockDb.boardMeeting.findUnique.mockResolvedValue({
        id: meetingId,
        tenantId: 'tenant-123',
        startedAt: new Date(),
        endedAt: new Date(),
        agenda: [],
        metadata: {},
        outcomeSummary: '',
        tokenUsage: {},
      });

      const req = request(app).post('/c-suite/board-meeting').send({});

      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 50);

      setTimeout(() => {
        req.abort();
        expect(mockDb.$disconnect).toHaveBeenCalled();
        done();
      }, 200);
    });
  });

  describe('agenda status updates', () => {
  it('should stream agenda status changes', (done: DoneFn) => {
      let callCount = 0;
      mockDb.boardMeeting.findUnique.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          id: meetingId,
          tenantId: 'tenant-123',
          startedAt: new Date(),
          endedAt: null,
          agenda: [
            {
              id: 'exec-overview',
              title: 'Executive Overview',
              personaId: 'ceo',
              status: callCount === 1 ? 'pending' : 'in_progress',
            },
          ],
          metadata: {},
          outcomeSummary: null,
          tokenUsage: null,
        });
      });

      const req = request(app).post('/c-suite/board-meeting').send({});

      let chunks = '';
      req.on('data', (chunk) => {
        chunks += chunk.toString();
      });

      // Trigger multiple poll cycles
      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 50);

      setTimeout(() => {
        vi.advanceTimersByTime(1500);
      }, 100);

      setTimeout(() => {
        req.abort();
        const events = parseSSEEvents(chunks);
        const agendaEvents = events.filter((e) => e.type === 'agenda');

        const statusChanges = agendaEvents.filter((e: any) => e.data.sectionId === 'exec-overview');
        expect(statusChanges.length).toBeGreaterThan(1);

        done();
      }, 250);
    });
  });
});
