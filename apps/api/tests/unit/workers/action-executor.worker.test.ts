// @ts-nocheck
import type { Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __test__ as workerTest } from '../../../src/workers/action-executor.worker.js';
import type { ActionExecutorJobData } from '../../../src/queue/index.js';

const mocks = vi.hoisted(() => {
  const executeModuleCapability = vi.fn(async () => ({
    status: 'completed',
    processed: 10,
  }));
  const notifyActionExecutionResult = vi.fn().mockResolvedValue(undefined);
  class ModuleExecutionError extends Error {}
  return { executeModuleCapability, notifyActionExecutionResult, ModuleExecutionError };
});

vi.mock('../../../src/modules/registry.js', () => ({
  executeModuleCapability: mocks.executeModuleCapability,
  ModuleExecutionError: mocks.ModuleExecutionError,
}));

vi.mock('../../../src/services/notifications.js', () => ({
  notifyActionApprovalSubmitted: vi.fn(),
  notifyActionApprovalDecision: vi.fn(),
  notifyActionExecutionResult: mocks.notifyActionExecutionResult,
}));

const { executeModuleCapability, notifyActionExecutionResult, ModuleExecutionError } = mocks;

function randomUUID(): string {
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

const tenantId = `tenant-${randomUUID()}`;
const userId = `user-${randomUUID()}`;

type AuditLogEntry = {
  event: string;
  at: string;
  by: string;
  note?: string;
  metadata?: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;

interface MockActionApproval {
  id: string;
  tenantId: string;
  source: string;
  payload: JsonRecord;
  riskScore: number;
  status: string;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  executedAt: Date | null;
  auditLog: AuditLogEntry[];
  actionItemId: string | null;
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MockTask {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  status: string;
  priority: string;
  queueName: string | null;
  jobId: string | null;
  actionApprovalId: string | null;
  moduleSlug: string | null;
  payload: JsonRecord;
  result: unknown;
  error: string | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const store = {
  approvals: new Map<string, MockActionApproval>(),
  tasks: new Map<string, MockTask>(),
};

function cloneApproval(approval: MockActionApproval): MockActionApproval {
  return {
    ...approval,
    auditLog: approval.auditLog.map((entry) => ({
      ...entry,
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    })),
  };
}

function cloneTask(task: MockTask | null): MockTask | null {
  if (!task) {
    return null;
  }
  return { ...task };
}

function resetStore() {
  store.approvals.clear();
  store.tasks.clear();
}

function seedApproval(overrides: Partial<MockActionApproval> = {}): MockActionApproval {
  const id = overrides.id ?? `approval-${randomUUID()}`;
  const now = new Date();

  const approval: MockActionApproval = {
    id,
    tenantId,
    source: overrides.source ?? 'module:test-orchestrator',
    payload: (overrides.payload as JsonRecord) ?? {
      moduleSlug: 'growth-pulse',
      capability: 'send-email',
      undoPayload: { campaignId: 'demo-campaign' },
    },
    riskScore: overrides.riskScore ?? 48,
    status: overrides.status ?? 'approved',
    createdBy: overrides.createdBy ?? userId,
    approvedBy: overrides.approvedBy ?? userId,
    approvedAt: overrides.approvedAt ?? now,
    executedAt: overrides.executedAt ?? null,
    auditLog: overrides.auditLog?.map((entry) => ({ ...entry })) ?? [],
    actionItemId: overrides.actionItemId ?? null,
    taskId: overrides.taskId ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };

  store.approvals.set(id, approval);
  return approval;
}

function getApproval(id: string): MockActionApproval | undefined {
  const record = store.approvals.get(id);
  return record ? cloneApproval(record) : undefined;
}

function getTaskByApproval(approvalId: string): MockTask | undefined {
  for (const task of store.tasks.values()) {
    if (task.actionApprovalId === approvalId) {
      return cloneTask(task) ?? undefined;
    }
  }
  return undefined;
}

type ApprovedActionOverrides = Partial<MockActionApproval> & {
  moduleSlug?: string;
  capability?: string;
};

async function createApprovedAction(overrides: ApprovedActionOverrides = {}): Promise<MockActionApproval> {
  const {
    moduleSlug = 'growth-pulse',
    capability = 'send-email',
    payload,
    status,
    ...approvalOverrides
  } = overrides;

  const mergedPayload: JsonRecord = {
    moduleSlug,
    capability,
    undoPayload: { campaignId: 'demo-campaign' },
    ...(payload as JsonRecord | undefined),
  };

  const approval = seedApproval({
    status: status ?? 'approved',
    payload: mergedPayload,
    ...approvalOverrides,
  });

  return cloneApproval(approval);
}

async function createTestTenant(_tenantId: string = tenantId) {
  resetStore();
  return { id: tenantId };
}

async function createTestUser(_tenantId: string = tenantId, _userId: string = userId) {
  return { id: userId };
}

async function cleanupTestData(_tenantId: string = tenantId, _userId: string = userId) {
  resetStore();
}

async function clearTenantData() {
  resetStore();
}

function createMockPrisma() {
  const actionApprovalDelegate = {
    findUnique: async ({ where, include }: any) => {
      const id = where?.id as string | undefined;
      const record = id ? store.approvals.get(id) : undefined;
      if (!record) {
        return null;
      }
      const approval: any = cloneApproval(record);
      if (include?.task) {
        approval.task = record.taskId ? cloneTask(store.tasks.get(record.taskId) ?? null) : null;
      }
      return approval;
    },
    update: async ({ where, data, include }: any) => {
      const id = where?.id as string | undefined;
      const record = id ? store.approvals.get(id) : undefined;
      if (!record) {
        throw new Error('Approval not found');
      }

      const updated: MockActionApproval = {
        ...record,
        ...(Object.prototype.hasOwnProperty.call(data, 'status') ? { status: data.status } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'approvedBy')
          ? { approvedBy: data.approvedBy ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'approvedAt')
          ? { approvedAt: data.approvedAt ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'executedAt')
          ? { executedAt: data.executedAt ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'auditLog')
          ? { auditLog: Array.isArray(data.auditLog) ? data.auditLog : [] }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'payload')
          ? { payload: data.payload as JsonRecord }
          : {}),
      };

      updated.updatedAt = new Date();
      store.approvals.set(updated.id, updated);

      const approval: any = cloneApproval(updated);
      if (include?.task) {
        approval.task = updated.taskId ? cloneTask(store.tasks.get(updated.taskId) ?? null) : null;
      }
      return approval;
    },
  };

  const taskDelegate = {
    create: async ({ data }: any) => {
      const id = data.id ?? `task-${randomUUID()}`;
      const now = new Date();

      const task: MockTask = {
        id,
        tenantId: data.tenantId ?? tenantId,
        userId: data.userId ?? userId,
        type: data.type ?? 'action-execution',
        status: data.status ?? 'pending',
        priority: data.priority ?? 'normal',
        queueName: data.queueName ?? null,
        jobId: data.jobId ?? null,
        actionApprovalId: data.actionApprovalId ?? null,
        moduleSlug: data.moduleSlug ?? null,
        payload: (data.payload as JsonRecord) ?? {},
        result: data.result ?? null,
        error: data.error ?? null,
        executedAt: data.executedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };

      if (task.actionApprovalId) {
        const approval = store.approvals.get(task.actionApprovalId);
        if (approval) {
          approval.taskId = task.id;
          store.approvals.set(approval.id, approval);
        }
      }

      store.tasks.set(id, task);
      return cloneTask(task);
    },
    update: async ({ where, data }: any) => {
      const id = where?.id as string | undefined;
      const record = id ? store.tasks.get(id) : undefined;
      if (!record) {
        throw new Error('Task not found');
      }

      const updated: MockTask = {
        ...record,
        ...(Object.prototype.hasOwnProperty.call(data, 'status') ? { status: data.status } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'queueName')
          ? { queueName: data.queueName ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'jobId')
          ? { jobId: data.jobId ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'error')
          ? { error: data.error ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'result') ? { result: data.result } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'executedAt')
          ? { executedAt: data.executedAt ?? null }
          : {}),
      };

      updated.updatedAt = new Date();
      store.tasks.set(updated.id, updated);
      return cloneTask(updated);
    },
    findFirst: async ({ where }: any) => {
      if (!where) {
        const first = store.tasks.values().next().value as MockTask | undefined;
        return cloneTask(first ?? null);
      }

      for (const task of store.tasks.values()) {
        if (where.actionApprovalId && task.actionApprovalId === where.actionApprovalId) {
          return cloneTask(task);
        }
      }

      return null;
    },
  };

  return {
    actionApproval: actionApprovalDelegate,
    task: taskDelegate,
    $transaction: async (callback: any) => {
      const txClient = {
        actionApproval: actionApprovalDelegate,
        task: taskDelegate,
      };
      return callback(txClient);
    },
    $disconnect: async () => Promise.resolve(),
  } as const;
}

const mockCreateTenantClient = vi.hoisted(() => vi.fn(() => createMockPrisma()));

vi.mock('@ocsuite/db', async () => {
  const actual = await vi.importActual<typeof import('@ocsuite/db')>('@ocsuite/db');
  return {
    ...actual,
    createTenantClient: mockCreateTenantClient,
  };
});

function createJob(data: ActionExecutorJobData): Job<ActionExecutorJobData> {
  return {
    id: `job-${data.approvalId}`,
    name: 'execute-action',
    data,
    attemptsMade: 0,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ActionExecutorJobData>;
}

describe('action-executor worker', () => {
  beforeAll(async () => {
    await createTestTenant(tenantId);
    await createTestUser(tenantId, userId);
  });

  afterAll(async () => {
    await cleanupTestData(tenantId, userId);
  });

  beforeEach(async () => {
    executeModuleCapability.mockReset();
    executeModuleCapability.mockResolvedValue({ status: 'completed', processed: 10 });
    notifyActionExecutionResult.mockClear();
    await clearTenantData();
  });

  it('executes approved actions and marks them completed', async () => {
    const approval = await createApprovedAction();

    const jobData: ActionExecutorJobData = {
      tenantId,
      approvalId: approval.id,
      source: approval.source,
      payload: {
        moduleSlug: 'growth-pulse',
        capability: 'send-email',
        undoPayload: { campaignId: 'demo-campaign' },
      },
      createdBy: userId,
      approvedBy: userId,
      moduleSlug: 'growth-pulse',
      capability: 'send-email',
      undoPayload: { campaignId: 'demo-campaign' },
      riskScore: approval.riskScore,
    };

    const job = createJob(jobData);

    const result = await workerTest.processActionExecution(job);

    expect(result.success).toBe(true);
    expect(result.skipped).not.toBe(true);
    expect(executeModuleCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleSlug: 'growth-pulse',
        capability: 'send-email',
      })
    );
    expect(notifyActionExecutionResult).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        result: 'executed',
        approval: expect.objectContaining({ id: approval.id }),
      })
    );

    const stored = getApproval(approval.id);
    expect(stored?.status).toBe('executed');
    expect(stored?.executedAt).not.toBeNull();

    const task = getTaskByApproval(approval.id);
    expect(task).not.toBeNull();
    expect(task?.status).toBe('completed');
    expect(task?.queueName).toBe('action-executor');

    const secondRun = await workerTest.processActionExecution(job);
    expect(secondRun.skipped).toBe(true);
  });

  it('records failure details when module execution throws', async () => {
    const approval = await createApprovedAction({
      moduleSlug: 'ops-automator',
      capability: 'sync-records',
    });

    executeModuleCapability.mockImplementationOnce(() => {
      throw new ModuleExecutionError('Capability misconfigured');
    });

    const job = createJob({
      tenantId,
      approvalId: approval.id,
      source: approval.source,
      payload: {
        moduleSlug: 'ops-automator',
        capability: 'sync-records',
      },
      createdBy: userId,
      approvedBy: userId,
      moduleSlug: 'ops-automator',
      capability: 'sync-records',
    });

    await expect(workerTest.processActionExecution(job)).rejects.toThrow('Capability misconfigured');

    const stored = getApproval(approval.id);
    expect(stored?.status).toBe('failed');

    const task = getTaskByApproval(approval.id);
    expect(task?.status).toBe('failed');

    expect(notifyActionExecutionResult).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        result: 'failed',
      })
    );
  });
});
