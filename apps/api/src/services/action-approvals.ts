import { Prisma } from '@prisma/client';
import { PrismaClient, ActionApprovalStatus, ActionApproval, Task } from '@ocsuite/db';
import { enqueueActionExecution, EnqueueResult } from '../queue/client.js';
import { calculateActionRisk, ActionPayload } from '../utils/risk-scoring.js';
import { apiLogger } from '../utils/logger.js';
import { toJsonValue, toInputJson, parseJsonRecord } from '../utils/json.js';
import {
  notifyActionApprovalSubmitted,
  notifyActionApprovalDecision,
} from './notifications.js';

export type AuditEventType =
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'enqueued'
  | 'executing'
  | 'completed'
  | 'failed';

export type AuditMetadata = Prisma.JsonObject;

export interface AuditEvent {
  event: AuditEventType;
  at: string;
  by: string;
  note?: string;
  metadata?: AuditMetadata;
}

const AUDIT_EVENT_TYPES = new Set<AuditEventType>([
  'submitted',
  'approved',
  'rejected',
  'enqueued',
  'executing',
  'completed',
  'failed',
]);

function toAuditMetadata(metadata?: Record<string, unknown>): AuditMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const result: Prisma.JsonObject = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'undefined') {
      continue;
    }
    result[key] = toJsonValue(value);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function auditEventToJson(event: AuditEvent): Prisma.JsonObject {
  const json: Prisma.JsonObject = {
    event: event.event,
    at: event.at,
    by: event.by,
  };

  if (typeof event.note === 'string') {
    json.note = event.note;
  }

  if (event.metadata) {
    json.metadata = event.metadata;
  }

  return json;
}

export function auditEventsToJson(events: AuditEvent[]): Prisma.JsonArray {
  return events.map((event) => auditEventToJson(event)) as Prisma.JsonArray;
}

function parseAuditEvent(value: Prisma.JsonValue): AuditEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Prisma.JsonObject;
  const eventValue = record.event;
  const atValue = record.at;
  const byValue = record.by;

  if (!AUDIT_EVENT_TYPES.has(eventValue as AuditEventType)) {
    return null;
  }

  if (typeof atValue !== 'string' || typeof byValue !== 'string') {
    return null;
  }

  const noteValue = typeof record.note === 'string' ? record.note : undefined;
  const metadataValue = record.metadata;
  const metadata = metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)
    ? (metadataValue as Prisma.JsonObject)
    : undefined;

  return {
    event: eventValue as AuditEventType,
    at: atValue,
    by: byValue,
    note: noteValue,
    metadata,
  };
}

export interface SubmitActionParams {
  tenantId: string;
  userId: string;
  source: string;
  payload: ActionPayload;
  actionItemId?: string;
  comment?: string;
}

export interface SubmitActionResult {
  approval: ActionApproval;
  risk: {
    score: number;
    level: 'low' | 'medium' | 'high';
    reasons: string[];
  };
}

export interface ListActionFilters {
  status?: ActionApprovalStatus;
  minRisk?: number;
  maxRisk?: number;
  source?: string;
  createdBy?: string;
  limit?: number;
}

export interface ApproveActionParams {
  tenantId: string;
  userId: string;
  approvalId: string;
  comment?: string;
}

export interface ApproveActionResult {
  approval: ActionApproval;
  task: Task;
  job: EnqueueResult;
}

export interface RejectActionParams {
  tenantId: string;
  userId: string;
  approvalId: string;
  comment?: string;
}

export class ActionApprovalNotFoundError extends Error {
  constructor(message = 'Action approval not found') {
    super(message);
    this.name = 'ActionApprovalNotFoundError';
  }
}

export class ActionApprovalStateError extends Error {
  constructor(message = 'Action approval is not in a valid state for this operation') {
    super(message);
    this.name = 'ActionApprovalStateError';
  }
}

export function normalizeAuditLog(value: Prisma.JsonValue | null | undefined): AuditEvent[] {
  if (!value) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => parseAuditEvent(entry))
    .filter((entry): entry is AuditEvent => entry !== null);
}

export function buildAuditEntry(
  event: AuditEvent['event'],
  by: string,
  note?: string,
  metadata?: Record<string, unknown>
): AuditEvent {
  const auditMetadata = toAuditMetadata(metadata);

  return {
    event,
    at: new Date().toISOString(),
    by,
    note,
    ...(auditMetadata ? { metadata: auditMetadata } : {}),
  };
}

export function payloadToRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return parseJsonRecord(value);
}

function extractModuleSlug(payload: Record<string, unknown>): string | undefined {
  const value = payload['moduleSlug'];
  return typeof value === 'string' ? value : undefined;
}

function extractCapability(payload: Record<string, unknown>): string | undefined {
  const value = payload['capability'];
  return typeof value === 'string' ? value : undefined;
}

function extractUndoPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const value = payload['undoPayload'];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export async function submitActionApproval(
  db: PrismaClient,
  params: SubmitActionParams
): Promise<SubmitActionResult> {
  const { tenantId, userId, source, payload, actionItemId, comment } = params;

  const risk = calculateActionRisk({ source, payload });

  const payloadJson = toInputJson(payload);
  const auditLog: AuditEvent[] = [
    buildAuditEntry('submitted', userId, comment, {
      riskScore: risk.score,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
    }),
  ];

  const approval = await db.actionApproval.create({
    data: {
      tenantId,
      actionItemId: actionItemId ?? null,
      source,
      payload: payloadJson,
      riskScore: risk.score,
      status: 'pending',
      createdBy: userId,
      auditLog: auditEventsToJson(auditLog),
    },
  });

  apiLogger.info('Action approval submitted', {
    tenantId,
    approvalId: approval.id,
    source,
    riskScore: risk.score,
    riskLevel: risk.level,
  });

  await notifyActionApprovalSubmitted(db, {
    tenantId,
    approval,
    actorClerkId: userId,
    comment,
    risk,
  });

  return {
    approval,
    risk,
  };
}

export async function listActionApprovals(
  db: PrismaClient,
  filters: ListActionFilters
): Promise<ActionApproval[]> {
  const {
    status = 'pending',
    minRisk,
    maxRisk,
    source,
    createdBy,
    limit = 100,
  } = filters;

  return db.actionApproval.findMany({
    where: {
      status,
      source: source ? { contains: source, mode: 'insensitive' } : undefined,
      createdBy,
      riskScore: {
        gte: typeof minRisk === 'number' ? minRisk : undefined,
        lte: typeof maxRisk === 'number' ? maxRisk : undefined,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 250),
  });
}

export async function approveAction(
  db: PrismaClient,
  params: ApproveActionParams
): Promise<ApproveActionResult> {
  const { tenantId, userId, approvalId, comment } = params;

  const { approval, task } = await db.$transaction(async (tx) => {
    const existing = await tx.actionApproval.findUnique({
      where: { id: approvalId },
    });

    if (!existing || existing.tenantId !== tenantId) {
      throw new ActionApprovalNotFoundError();
    }

    if (existing.status !== 'pending') {
      throw new ActionApprovalStateError('Only pending approvals can be approved');
    }

    const nextAudit = [
      ...normalizeAuditLog(existing.auditLog),
      buildAuditEntry('approved', userId, comment),
    ];

    const updated = await tx.actionApproval.update({
      where: { id: approvalId },
      data: {
        status: 'approved',
        approvedBy: userId,
        approvedAt: new Date(),
        auditLog: auditEventsToJson(nextAudit),
      },
    });

    const payloadRecord = payloadToRecord(updated.payload);

    const task = await tx.task.upsert({
      where: { actionApprovalId: approvalId },
      update: {
        status: 'pending',
  payload: toInputJson(updated.payload),
        moduleSlug: extractModuleSlug(payloadRecord) ?? null,
        priority: 'normal',
        queueName: null,
        jobId: null,
        error: null,
        result: Prisma.JsonNull,
      },
      create: {
        tenantId,
        userId,
        type: 'action-execution',
        status: 'pending',
        priority: 'normal',
  payload: toInputJson(updated.payload),
        moduleSlug: extractModuleSlug(payloadRecord) ?? null,
        actionApprovalId: approvalId,
      },
    });

    return { approval: updated, task };
  });

  const approvalPayload = payloadToRecord(approval.payload);

  let job: EnqueueResult;
  try {
    job = await enqueueActionExecution({
      tenantId,
      approvalId: approval.id,
      source: approval.source,
      payload: approvalPayload,
      createdBy: approval.createdBy,
      approvedBy: userId,
      actionItemId: approval.actionItemId ?? undefined,
      moduleSlug: extractModuleSlug(approvalPayload),
      capability: extractCapability(approvalPayload),
      undoPayload: extractUndoPayload(approvalPayload),
      riskScore: approval.riskScore,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const failedLog = [
      ...normalizeAuditLog(approval.auditLog),
      buildAuditEntry('failed', userId, `Queue enqueue failed: ${message}`),
    ];

    await db.actionApproval.update({
      where: { id: approval.id },
      data: {
        status: 'failed',
        auditLog: auditEventsToJson(failedLog),
      },
    });

    apiLogger.error('Failed to enqueue action execution job', {
      tenantId,
      approvalId,
      error: message,
    });

    throw error;
  }

  const taskWithJob = await db.task.update({
    where: { id: task.id },
    data: {
      queueName: job.queueName,
      jobId: job.jobId,
    },
  });

  const updatedApproval = await db.actionApproval.update({
    where: { id: approval.id },
    data: {
      auditLog: auditEventsToJson([
        ...normalizeAuditLog(approval.auditLog),
        buildAuditEntry('enqueued', userId, undefined, { jobId: job.jobId }),
      ]),
    },
  });

  apiLogger.info('Action approval approved and enqueued', {
    tenantId,
    approvalId,
    jobId: job.jobId,
    taskId: task.id,
  });

  await notifyActionApprovalDecision(db, {
    tenantId,
    actorClerkId: userId,
    approval: updatedApproval,
    decision: 'approved',
    comment,
  });

  return {
    approval: updatedApproval,
    task: taskWithJob,
    job,
  };
}

export async function rejectAction(
  db: PrismaClient,
  params: RejectActionParams
): Promise<ActionApproval> {
  const { tenantId, userId, approvalId, comment } = params;

  const updated = await db.$transaction(async (tx) => {
    const existing = await tx.actionApproval.findUnique({
      where: { id: approvalId },
    });

    if (!existing || existing.tenantId !== tenantId) {
      throw new ActionApprovalNotFoundError();
    }

    if (existing.status !== 'pending') {
      throw new ActionApprovalStateError('Only pending approvals can be rejected');
    }

    const nextAudit = [
      ...normalizeAuditLog(existing.auditLog),
      buildAuditEntry('rejected', userId, comment),
    ];

    return tx.actionApproval.update({
      where: { id: approvalId },
      data: {
        status: 'rejected',
        approvedBy: null,
        approvedAt: null,
        auditLog: auditEventsToJson(nextAudit),
      },
    });
  });

  apiLogger.info('Action approval rejected', {
    tenantId,
    approvalId,
    userId,
  });

  await notifyActionApprovalDecision(db, {
    tenantId,
    actorClerkId: userId,
    approval: updated,
    decision: 'rejected',
    comment,
  });

  return updated;
}
