import type {
  PrismaClient,
  NotificationChannel,
  ActionApproval,
  Alert,
  Prisma,
} from '@ocsuite/db';
import { TenantMemberRole } from '@ocsuite/db';
import { parseJsonRecord, toInputJson } from '../utils/json.js';
import { apiLogger } from '../utils/logger.js';

interface Recipient {
  userId: string;
  channel: NotificationChannel;
}

interface BaseNotificationContext {
  tenantId: string;
  actorClerkId?: string;
}

interface ApprovalSubmittedContext extends BaseNotificationContext {
  approval: ActionApproval;
  risk: {
    score: number;
    level: 'low' | 'medium' | 'high';
    reasons: string[];
  };
  comment?: string;
}

interface ApprovalDecisionContext extends BaseNotificationContext {
  approval: ActionApproval;
  decision: 'approved' | 'rejected';
  comment?: string;
}

interface ExecutionResultContext extends BaseNotificationContext {
  approval: ActionApproval;
  result: 'executed' | 'failed';
  metadata?: Record<string, unknown>;
}

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

async function resolveActorUserId(
  db: DatabaseClient,
  clerkId?: string
): Promise<string | undefined> {
  if (!clerkId) {
    return undefined;
  }

  const user = await db.user.findFirst({
    where: { clerkId },
    select: { id: true },
  });

  return user?.id;
}

async function findRecipients(
  db: DatabaseClient,
  tenantId: string,
  roles: TenantMemberRole[],
  excludeUserIds: string[] = []
): Promise<Recipient[]> {
  const members = await db.tenantMember.findMany({
    where: {
      tenantId,
      role: { in: roles },
      userId: { notIn: excludeUserIds.length ? excludeUserIds : undefined },
    },
    select: {
      userId: true,
    },
  });

  return members.map((member) => ({
    userId: member.userId,
    channel: 'in_app',
  }));
}

async function notify(
  db: DatabaseClient,
  context: BaseNotificationContext,
  recipients: Recipient[],
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!recipients.length) {
    return;
  }

  const uniqueUserIds = Array.from(new Set(recipients.map((recipient) => recipient.userId)));

  const preferences = await db.notificationPreference.findMany({
    where: {
      tenantId: context.tenantId,
      userId: { in: uniqueUserIds },
    },
  });

  const preferenceMap = new Map<string, boolean>();

  for (const preference of preferences) {
    preferenceMap.set(`${preference.userId}:${preference.channel}`, preference.enabled);
  }

  const filteredRecipients = recipients.filter((recipient) => {
    const key = `${recipient.userId}:${recipient.channel}`;
    const preference = preferenceMap.get(key);

    if (typeof preference === 'boolean') {
      return preference;
    }

    // Default behaviour: in-app notifications enabled, others disabled until configured
    return recipient.channel === 'in_app';
  });

  if (!filteredRecipients.length) {
    return;
  }

  try {
    await db.notification.createMany({
      data: filteredRecipients.map((recipient) => ({
        tenantId: context.tenantId,
        userId: recipient.userId,
        type,
        channel: recipient.channel,
        payload: toInputJson(payload),
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    apiLogger.error('Failed to create notifications', {
      type,
      tenantId: context.tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function notifyActionApprovalSubmitted(
  db: DatabaseClient,
  context: ApprovalSubmittedContext
): Promise<void> {
  const actorUserId = await resolveActorUserId(db, context.actorClerkId);

  const recipients = await findRecipients(
    db,
    context.tenantId,
    [TenantMemberRole.owner, TenantMemberRole.admin],
    actorUserId ? [actorUserId] : []
  );

  const payloadRecord = parseJsonRecord(context.approval.payload);

  await notify(db, context, recipients, 'action-approval.submitted', {
    approvalId: context.approval.id,
    moduleSlug: typeof payloadRecord.moduleSlug === 'string' ? payloadRecord.moduleSlug : null,
    status: context.approval.status,
    risk: context.risk,
    comment: context.comment ?? null,
  });
}

export async function notifyActionApprovalDecision(
  db: DatabaseClient,
  context: ApprovalDecisionContext
): Promise<void> {
  const requesterUserId = await resolveActorUserId(db, context.approval.createdBy ?? undefined);

  if (!requesterUserId) {
    return;
  }

  await notify(
    db,
    context,
    [{ userId: requesterUserId, channel: 'in_app' }],
    `action-approval.${context.decision}`,
    {
      approvalId: context.approval.id,
      decision: context.decision,
      comment: context.comment ?? null,
      approvedBy: context.approval.approvedBy ?? null,
      approvedAt: context.approval.approvedAt ?? null,
    }
  );
}

export async function notifyActionExecutionResult(
  db: DatabaseClient,
  context: ExecutionResultContext
): Promise<void> {
  const requesterUserId = await resolveActorUserId(db, context.approval.createdBy ?? undefined);

  if (!requesterUserId) {
    return;
  }

  await notify(
    db,
    context,
    [{ userId: requesterUserId, channel: 'in_app' }],
    `action-approval.${context.result}`,
    {
      approvalId: context.approval.id,
      result: context.result,
      metadata: context.metadata ?? null,
    }
  );
}

export async function notifyAlertRaised(
  db: DatabaseClient,
  params: {
    tenantId: string;
    alert: Alert;
  }
): Promise<void> {
  const recipients = await findRecipients(db, params.tenantId, [TenantMemberRole.owner, TenantMemberRole.admin]);

  if (!recipients.length) {
    return;
  }

  await notify(
    db,
    { tenantId: params.tenantId },
    recipients,
    'alert.triggered',
    {
      alertId: params.alert.id,
      severity: params.alert.severity,
      status: params.alert.status,
      summary: params.alert.summary,
      ruleId: params.alert.ruleId,
      createdAt: params.alert.createdAt,
    }
  );
}
