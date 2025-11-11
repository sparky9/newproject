import type { PrismaClient } from '@ocsuite/db';

import { createContextLogger } from '../utils/logger.js';
import { toInputJson } from '../utils/json.js';

export type KnowledgeAuditEventType = 'upload' | 'delete' | 'export';

export interface RecordKnowledgeAuditEventParams {
  prisma: PrismaClient;
  tenantId: string | null;
  sourceId: string | null;
  sourceName: string;
  actorId?: string;
  event: KnowledgeAuditEventType;
  summary: string;
  entryCount: number;
  metadata?: Record<string, unknown>;
}

const auditLogger = createContextLogger('knowledge-audit');

function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'undefined') {
      continue;
    }
    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export async function recordKnowledgeAuditEvent(params: RecordKnowledgeAuditEventParams): Promise<void> {
  const { prisma, tenantId, sourceId, sourceName, actorId, event, summary, entryCount, metadata } = params;

  const sanitizedMetadata = sanitizeMetadata(metadata);

  try {
    await prisma.knowledgeAuditEvent.create({
      data: {
        tenantId,
        sourceId,
        sourceName,
        event,
        actorId: actorId ?? null,
        summary,
        entryCount: Math.max(0, entryCount),
        metadata: sanitizedMetadata ? toInputJson(sanitizedMetadata) : undefined,
      },
    });
  } catch (error) {
    auditLogger.error('Failed to record knowledge audit event', {
      tenantId: tenantId ?? 'hq',
      sourceId,
      event,
      summary,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
