import { beforeAll, afterAll, vi } from 'vitest';
import { z } from 'zod';
import dotenv from 'dotenv';
import { initializeCrypto } from '@ocsuite/crypto';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '@ocsuite/db';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set NODE_ENV to test if not already set
if (!process.env.NODE_ENV) {
  Reflect.set(process.env, 'NODE_ENV', 'test');
}

// Set required environment variables for testing
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/csuite_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || 'test-clerk-secret-key';
process.env.CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY || 'test-clerk-publishable-key';
process.env.MASTER_ENCRYPTION_KEY =
  process.env.MASTER_ENCRYPTION_KEY || 'cSuiteLocalMasterKey_A1B2C3D4E5F6G7H8I9J0PQRS';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.PORT = process.env.PORT || '3001';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/google/callback';

const defaultUserId = 'test-user-00000000-0000-0000-0000-000000000001';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async () => ({
    sub: defaultUserId,
    sid: 'test-session-id',
  })),
}));

vi.mock('@clerk/express', () => ({
  clerkClient: {
    users: {
      getUser: vi.fn(async (userId: string) => ({
        id: userId,
        firstName: 'Test',
        lastName: 'User',
        emailAddresses: [],
      })),
    },
  },
}));

vi.mock('@ocsuite/module-sdk', () => {
  const personas = [
    {
      id: 'ceo',
      name: 'Chief Executive Officer',
      tone: 'decisive, strategic',
      expertise: ['strategy', 'operations'],
      maxTokens: 450,
      streamChunkSize: 120,
      focus: 'Synthesize inputs into directives.',
      requiredContext: ['businessProfile', 'moduleInsights'],
    },
    {
      id: 'cfo',
      name: 'Chief Financial Officer',
      tone: 'analytic, risk-aware',
      expertise: ['finance', 'cash flow'],
      maxTokens: 380,
      streamChunkSize: 100,
      focus: 'Evaluate financial implications.',
      requiredContext: ['analyticsSnapshots', 'revenueMetrics'],
    },
    {
      id: 'cmo',
      name: 'Chief Marketing Officer',
      tone: 'customer-centric, energetic',
      expertise: ['marketing', 'demand gen'],
      maxTokens: 420,
      streamChunkSize: 110,
      focus: 'Translate funnel signals into campaigns.',
      requiredContext: ['moduleInsights', 'recentWins'],
    },
    {
      id: 'cto',
      name: 'Chief Technology Officer',
      tone: 'systems-oriented, calm',
      expertise: ['technology', 'delivery'],
      maxTokens: 400,
      streamChunkSize: 105,
      focus: 'Surface engineering risks and trade-offs.',
      requiredContext: ['moduleInsights', 'technicalInitiatives'],
    },
  ];

  const getPersonaById = vi.fn((personaId: string) => personas.find((persona) => persona.id === personaId));

  const WidgetRegistrationSchema = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    requiredCapabilities: z.array(z.string()).default([]),
    dashboard: z
      .object({
        tile: z
          .object({
            title: z.string(),
            description: z.string().optional(),
            href: z.string().optional(),
            variant: z.string().optional(),
            icon: z.string().optional(),
          })
          .strict(),
        tags: z.array(z.string()).optional(),
      })
      .optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const normalizeWidgetRegistration = (input: unknown) => {
    const result = WidgetRegistrationSchema.parse(input);
    return {
      ...result,
      requiredCapabilities: result.requiredCapabilities ?? [],
    };
  };

  return {
    PERSONAS: personas,
    getPersonaById,
    WidgetRegistrationSchema,
    normalizeWidgetRegistration,
  };
});

vi.mock('bullmq', () => {
  class QueueMock {
    name: string;

    constructor(name: string) {
      this.name = name;
    }

    add = vi.fn(async (jobName: string, data: unknown) => ({
      id: `${jobName}-${randomUUID()}`,
      name: jobName,
      data,
      returnvalue: undefined,
      failedReason: undefined,
      progress: 0,
    }));

    addBulk = vi.fn(async () => []);
    getJob = vi.fn(async () => null);
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    getActiveCount = vi.fn(async () => 0);
    getWaitingCount = vi.fn(async () => 0);
    getFailedCount = vi.fn(async () => 0);
  }

  class WorkerMock {
    name: string;
    processFn: (job: unknown) => Promise<unknown>;
    options: Record<string, unknown>;
    handlers: Map<string, Array<(...args: unknown[]) => void>>;

    constructor(name: string, processor: (job: unknown) => Promise<unknown>, options: Record<string, unknown>) {
      this.name = name;
      this.processFn = processor;
      this.options = options;
      this.handlers = new Map();
    }

    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = this.handlers.get(event) ?? [];
      existing.push(handler);
      this.handlers.set(event, existing);
      return this;
    });

    async emit(event: string, ...args: unknown[]) {
      const listeners = this.handlers.get(event) ?? [];
      for (const listener of listeners) {
        await listener(...args);
      }
    }

    async run(job: unknown) {
      return this.processFn(job);
    }

    close = vi.fn(async () => undefined);
  }

  return {
    Queue: QueueMock,
    Worker: WorkerMock,
    QueueScheduler: class {
      close = vi.fn(async () => undefined);
    },
    QueueEvents: class {
      close = vi.fn(async () => undefined);
    },
  };
});

vi.mock('../src/middleware/rate-limit.js', () => ({
  chatRateLimiter: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  apiRateLimiter: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  strictRateLimiter: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

type QueueStub = {
  name: string;
  add: ReturnType<typeof vi.fn>;
  addBulk: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  waitUntilReady: ReturnType<typeof vi.fn>;
  getActiveCount: ReturnType<typeof vi.fn>;
  getWaitingCount: ReturnType<typeof vi.fn>;
  getFailedCount: ReturnType<typeof vi.fn>;
};

const createQueueStub = (queueName: string): QueueStub => {
  const add = vi.fn(async (jobName: string, data: unknown) => ({
    id: `${jobName}-${randomUUID()}`,
    name: jobName,
    data,
    returnvalue: undefined,
    failedReason: undefined,
    progress: 0,
  }));

  return {
    name: queueName,
    add,
    addBulk: vi.fn(async () => []),
    getJob: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
    waitUntilReady: vi.fn(async () => undefined),
    getActiveCount: vi.fn(async () => 0),
    getWaitingCount: vi.fn(async () => 0),
    getFailedCount: vi.fn(async () => 0),
  };
};

const queueStubs = {
  syncConnectorQueue: createQueueStub('sync-connector'),
  executeTaskQueue: createQueueStub('execute-task'),
  actionExecutorQueue: createQueueStub('action-executor'),
  syncAnalyticsQueue: createQueueStub('sync-analytics'),
  alertsQueue: createQueueStub('alerts'),
  boardMeetingQueue: createQueueStub('board-meeting'),
  syncConnectorDLQ: createQueueStub('sync-connector-dlq'),
  executeTaskDLQ: createQueueStub('execute-task-dlq'),
  actionExecutorDLQ: createQueueStub('action-executor-dlq'),
  syncAnalyticsDLQ: createQueueStub('sync-analytics-dlq'),
  alertsDLQ: createQueueStub('alerts-dlq'),
  boardMeetingDLQ: createQueueStub('board-meeting-dlq'),
} as const;

vi.mock('../src/queue/index.js', () => {
  const stateStore = new Map<string, { value: string; expiresAt: number }>();

  const rateLimitState = new Map<string, { hits: number; expiresAt: number; windowMs: number }>();
  const scriptRegistry = new Map<string, 'increment' | 'get'>();
  let scriptCounter = 0;

  const commandHandler = async (command: string, ...args: unknown[]) => {
    const upper = command.toUpperCase();

    switch (upper) {
      case 'SCRIPT': {
        const action = String(args[0] ?? '').toUpperCase();
        if (action === 'LOAD') {
          const script = String(args[1] ?? '');
          const scriptType: 'increment' | 'get' = script.includes('INCR') ? 'increment' : 'get';
          const sha = `mock-sha-${++scriptCounter}-${scriptType}`;
          scriptRegistry.set(sha, scriptType);
          return sha;
        }
        return 'OK';
      }
      case 'EVALSHA': {
        const sha = String(args[0] ?? '');
        const scriptType = scriptRegistry.get(sha);
        const key = String(args[2] ?? '');
        const now = Date.now();

        if (scriptType === 'increment') {
          const resetOnChange = String(args[3] ?? '0') === '1';
          const windowMs = Number(args[4] ?? 60000) || 60000;
          let entry = rateLimitState.get(key);

          if (!entry || entry.expiresAt <= now) {
            entry = { hits: 0, expiresAt: now + windowMs, windowMs };
          }

          entry.hits += 1;
          if (resetOnChange) {
            entry.expiresAt = now + windowMs;
          }

          rateLimitState.set(key, entry);

          return [entry.hits, Math.max(entry.expiresAt - now, 0)];
        }

        if (scriptType === 'get') {
          const entry = rateLimitState.get(key);
          if (!entry) {
            return [0, 0];
          }

          if (entry.expiresAt <= now) {
            rateLimitState.delete(key);
            return [0, 0];
          }

          return [entry.hits, Math.max(entry.expiresAt - now, 0)];
        }

        return [0, 0];
      }
      case 'DEL': {
        const key = String(args[0] ?? '');
        const existed = rateLimitState.delete(key);
        return existed ? 1 : 0;
      }
      case 'DECR': {
        const key = String(args[0] ?? '');
        const entry = rateLimitState.get(key);
        if (!entry) {
          return 0;
        }
        entry.hits = Math.max(entry.hits - 1, 0);
        rateLimitState.set(key, entry);
        return entry.hits;
      }
      default:
        return 1;
    }
  };

  const redisConnection = {
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => undefined),
    call: vi.fn(commandHandler),
    duplicate: vi.fn(() => redisConnection),
    setex: vi.fn(async (key: string, ttlSeconds: number, value: string) => {
      stateStore.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return 'OK';
    }),
    get: vi.fn(async (key: string) => {
      const entry = stateStore.get(key);
      if (!entry) {
        return null;
      }

      if (entry.expiresAt <= Date.now()) {
        stateStore.delete(key);
        return null;
      }

      return entry.value;
    }),
    del: vi.fn(async (key: string) => {
      const existed = stateStore.delete(key);
      return existed ? 1 : 0;
    }),
  };

  const QUEUE_NAMES = {
    SYNC_CONNECTOR: 'sync-connector',
    EXECUTE_TASK: 'execute-task',
    SYNC_ANALYTICS: 'sync-analytics',
    ALERTS: 'alerts',
    BOARD_MEETING: 'board-meeting',
    ACTION_EXECUTOR: 'action-executor',
    SYNC_CONNECTOR_DLQ: 'sync-connector-dlq',
    EXECUTE_TASK_DLQ: 'execute-task-dlq',
    SYNC_ANALYTICS_DLQ: 'sync-analytics-dlq',
    ALERTS_DLQ: 'alerts-dlq',
    BOARD_MEETING_DLQ: 'board-meeting-dlq',
    ACTION_EXECUTOR_DLQ: 'action-executor-dlq',
  } as const;

  return {
    QUEUE_NAMES,
    getRedisConnection: vi.fn(() => redisConnection),
    initializeQueues: vi.fn(async () => undefined),
    closeQueues: vi.fn(async () => undefined),
    syncConnectorQueue: queueStubs.syncConnectorQueue,
    executeTaskQueue: queueStubs.executeTaskQueue,
    actionExecutorQueue: queueStubs.actionExecutorQueue,
    syncAnalyticsQueue: queueStubs.syncAnalyticsQueue,
    alertsQueue: queueStubs.alertsQueue,
    boardMeetingQueue: queueStubs.boardMeetingQueue,
    syncConnectorDLQ: queueStubs.syncConnectorDLQ,
    executeTaskDLQ: queueStubs.executeTaskDLQ,
    actionExecutorDLQ: queueStubs.actionExecutorDLQ,
    syncAnalyticsDLQ: queueStubs.syncAnalyticsDLQ,
    alertsDLQ: queueStubs.alertsDLQ,
    boardMeetingDLQ: queueStubs.boardMeetingDLQ,
    queues: {
      [QUEUE_NAMES.SYNC_CONNECTOR]: queueStubs.syncConnectorQueue,
      [QUEUE_NAMES.EXECUTE_TASK]: queueStubs.executeTaskQueue,
      [QUEUE_NAMES.ACTION_EXECUTOR]: queueStubs.actionExecutorQueue,
      [QUEUE_NAMES.SYNC_ANALYTICS]: queueStubs.syncAnalyticsQueue,
      [QUEUE_NAMES.ALERTS]: queueStubs.alertsQueue,
      [QUEUE_NAMES.BOARD_MEETING]: queueStubs.boardMeetingQueue,
      [QUEUE_NAMES.SYNC_CONNECTOR_DLQ]: queueStubs.syncConnectorDLQ,
      [QUEUE_NAMES.EXECUTE_TASK_DLQ]: queueStubs.executeTaskDLQ,
      [QUEUE_NAMES.ACTION_EXECUTOR_DLQ]: queueStubs.actionExecutorDLQ,
      [QUEUE_NAMES.SYNC_ANALYTICS_DLQ]: queueStubs.syncAnalyticsDLQ,
      [QUEUE_NAMES.ALERTS_DLQ]: queueStubs.alertsDLQ,
      [QUEUE_NAMES.BOARD_MEETING_DLQ]: queueStubs.boardMeetingDLQ,
    },
  };
});

vi.mock('../src/middleware/auth.js', async () => {
  const actual = (await vi.importActual('../src/middleware/auth.js')) as typeof import('../src/middleware/auth.js');
  return {
    ...actual,
    validateClerkJWT: () => (req: Request, _res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        req.auth = {
          userId: defaultUserId,
          sessionId: 'test-session-id',
          claims: {},
        };
        req.clerkId = defaultUserId;
      } else {
        req.auth = undefined;
        req.clerkId = undefined;
      }

      next();
    },
    requireAuth: () => (req: Request, res: Response, next: NextFunction) => {
      if (!req.clerkId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required. Please provide a valid Bearer token.',
          code: 'AUTH_REQUIRED',
        });
      }

      next();
    },
  };
});

let phase6SchemaEnsured = false;

async function ensurePhase6Schema(): Promise<void> {
  if (phase6SchemaEnsured) {
    return;
  }

  const statements = [
    `DO $$
     BEGIN
       CREATE TYPE "TriggerRuleType" AS ENUM ('schedule', 'metric_threshold', 'anomaly');
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE TYPE "TriggerSeverity" AS ENUM ('info', 'warning', 'critical');
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE TYPE "AlertStatus" AS ENUM ('pending', 'acknowledged', 'resolved', 'snoozed');
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `CREATE TABLE IF NOT EXISTS trigger_rules (
       "id" TEXT PRIMARY KEY,
       "tenant_id" TEXT NOT NULL,
       "name" TEXT NOT NULL,
       "type" "TriggerRuleType" NOT NULL,
       "schedule_cron" TEXT,
       "metric_key" TEXT,
       "threshold_value" DOUBLE PRECISION,
       "window_days" INTEGER,
       "config_json" JSONB,
       "severity" "TriggerSeverity" NOT NULL DEFAULT 'warning',
       "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
       "last_run_at" TIMESTAMP,
       "last_triggered_at" TIMESTAMP,
       "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
       "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
     );`,
    `DO $$
     BEGIN
       ALTER TABLE trigger_rules
         ADD CONSTRAINT trigger_rules_tenant_fkey
         FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
         ON DELETE CASCADE ON UPDATE CASCADE;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `CREATE INDEX IF NOT EXISTS trigger_rules_tenant_enabled_idx
       ON trigger_rules ("tenant_id", "enabled");`,
    `CREATE TABLE IF NOT EXISTS alerts (
       "id" TEXT PRIMARY KEY,
       "tenant_id" TEXT NOT NULL,
       "rule_id" TEXT,
       "type" "TriggerRuleType",
       "severity" "TriggerSeverity" NOT NULL DEFAULT 'warning',
       "title" TEXT,
       "summary" TEXT,
       "payload" JSONB,
       "status" "AlertStatus" NOT NULL DEFAULT 'pending',
       "acknowledged_at" TIMESTAMP,
       "acknowledged_by" TEXT,
       "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
       "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
     );`,
    `DO $$
     BEGIN
       ALTER TABLE alerts
         ADD CONSTRAINT alerts_tenant_fkey
         FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
         ON DELETE CASCADE ON UPDATE CASCADE;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       ALTER TABLE alerts
         ADD CONSTRAINT alerts_rule_fkey
         FOREIGN KEY ("rule_id") REFERENCES trigger_rules("id")
         ON DELETE SET NULL ON UPDATE CASCADE;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `CREATE INDEX IF NOT EXISTS alerts_tenant_status_idx
       ON alerts ("tenant_id", "status");`,
    `CREATE INDEX IF NOT EXISTS alerts_rule_id_idx
       ON alerts ("rule_id");`,
    `CREATE TABLE IF NOT EXISTS widgets (
       "slug" TEXT PRIMARY KEY,
       "name" TEXT NOT NULL,
       "description" TEXT NOT NULL,
       "category" TEXT NOT NULL,
       "required_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
       "config" JSONB,
       "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
       "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
     );`,
    `CREATE TABLE IF NOT EXISTS tenant_widgets (
       "id" TEXT PRIMARY KEY,
       "tenant_id" TEXT NOT NULL,
       "widget_slug" TEXT NOT NULL,
       "enabled_at" TIMESTAMP NOT NULL DEFAULT NOW(),
       "settings_json" JSONB,
       "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
       "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
     );`,
    `DO $$
     BEGIN
       ALTER TABLE tenant_widgets
         ADD CONSTRAINT tenant_widgets_tenant_fkey
         FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
         ON DELETE CASCADE ON UPDATE CASCADE;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       ALTER TABLE tenant_widgets
         ADD CONSTRAINT tenant_widgets_widget_fkey
         FOREIGN KEY ("widget_slug") REFERENCES widgets("slug")
         ON DELETE CASCADE ON UPDATE CASCADE;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tenant_widgets_unique_install_idx
       ON tenant_widgets ("tenant_id", "widget_slug");`,
    `CREATE INDEX IF NOT EXISTS tenant_widgets_widget_idx
       ON tenant_widgets ("widget_slug");`,
    `CREATE TABLE IF NOT EXISTS billing_usage (
       "id" TEXT PRIMARY KEY,
       "tenant_id" TEXT NOT NULL,
       "date" DATE NOT NULL,
       "tokens_used" INTEGER NOT NULL DEFAULT 0,
       "tasks_executed" INTEGER NOT NULL DEFAULT 0,
       "alerts_triggered" INTEGER NOT NULL DEFAULT 0,
       "active_widgets" INTEGER NOT NULL DEFAULT 0,
       "metadata" JSONB,
       "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
     );`,
    `DO $$
     BEGIN
       ALTER TABLE billing_usage
         ADD CONSTRAINT billing_usage_tenant_fkey
         FOREIGN KEY ("tenant_id") REFERENCES tenants("id")
         ON DELETE CASCADE ON UPDATE CASCADE;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS billing_usage_date_unique_idx
       ON billing_usage ("tenant_id", "date");`,
    `CREATE INDEX IF NOT EXISTS billing_usage_tenant_idx
       ON billing_usage ("tenant_id");`,
    `ALTER TABLE usage_snapshots
       ADD COLUMN IF NOT EXISTS "alerts_triggered" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE usage_snapshots
       ADD COLUMN IF NOT EXISTS "active_widgets" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE usage_snapshots
       ADD COLUMN IF NOT EXISTS "summary_metrics" JSONB;`,
    `ALTER TABLE notifications
       ADD COLUMN IF NOT EXISTS "alert_id" TEXT;`,
    `CREATE INDEX IF NOT EXISTS notifications_alert_id_idx
       ON notifications ("alert_id");`,
    `DO $$
     BEGIN
       ALTER TABLE notifications
         ADD CONSTRAINT notifications_alert_fkey
         FOREIGN KEY ("alert_id") REFERENCES alerts("id")
         ON DELETE SET NULL ON UPDATE CASCADE;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `ALTER TABLE trigger_rules ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE tenant_widgets ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;`,
    `DO $$
     BEGIN
       CREATE POLICY "trigger_rules_tenant_select"
         ON trigger_rules
         FOR SELECT
         USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE POLICY "trigger_rules_tenant_write"
         ON trigger_rules
         FOR ALL
         USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
         WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE POLICY "alerts_tenant_select"
         ON alerts
         FOR SELECT
         USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE POLICY "alerts_tenant_write"
         ON alerts
         FOR ALL
         USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
         WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE POLICY "tenant_widgets_tenant_select"
         ON tenant_widgets
         FOR SELECT
         USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE POLICY "tenant_widgets_tenant_write"
         ON tenant_widgets
         FOR ALL
         USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
         WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE POLICY "billing_usage_tenant_select"
         ON billing_usage
         FOR SELECT
         USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
    `DO $$
     BEGIN
       CREATE POLICY "billing_usage_tenant_write"
         ON billing_usage
         FOR ALL
         USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
         WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END;
     $$;`,
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  phase6SchemaEnsured = true;
}

beforeAll(async () => {
  await ensurePhase6Schema();
  initializeCrypto(process.env.MASTER_ENCRYPTION_KEY!);
});

afterAll(async () => {
  // Clean up any global resources
  // Note: Individual tests should clean up their own test data
});
