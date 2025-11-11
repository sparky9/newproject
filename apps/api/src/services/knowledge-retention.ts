import type { PrismaClient } from '@ocsuite/db';
import { createContextLogger } from '../utils/logger.js';
import {
  clearStorageAdapterCache,
  getStorageAdapterForSource,
  normalizeStorageConfiguration,
} from './knowledge-storage.js';

const retentionLogger = createContextLogger('knowledge-retention');

export interface KnowledgeRetentionServiceOptions {
  prisma: PrismaClient;
  batchSize?: number;
  now?: () => Date;
}

export interface RetentionJobParams {
  tenantId?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface RetentionJobResult {
  deletedCount: number;
  skippedCount: number;
  batches: number;
  dryRun: boolean;
  sourcesTouched: number;
  errors: number;
  completedAt: string;
  hasMore: boolean;
}

export class KnowledgeRetentionService {
  private readonly prisma: PrismaClient;
  private readonly batchSize: number;
  private readonly now: () => Date;

  constructor(options: KnowledgeRetentionServiceOptions) {
    this.prisma = options.prisma;
    this.batchSize = options.batchSize ?? 250;
    this.now = options.now ?? (() => new Date());
  }

  async purgeExpiredEntries(params: RetentionJobParams = {}): Promise<RetentionJobResult> {
    const { tenantId, limit, dryRun = false } = params;
    const startedAt = this.now();

    let deletedCount = 0;
    let skippedCount = 0;
    let batches = 0;
    let errors = 0;
    const sourcesTouched = new Set<string>();

    const hasRemainingQuota = () => (typeof limit !== 'number' || deletedCount < limit);

    while (hasRemainingQuota()) {
      const remainingQuota = typeof limit === 'number' ? limit - deletedCount : undefined;

      const take = typeof remainingQuota === 'number'
        ? Math.max(0, Math.min(this.batchSize, remainingQuota))
        : this.batchSize;

      if (take === 0) {
        break;
      }

      const entries = await this.prisma.knowledgeEntry.findMany({
        where: {
          retentionExpiresAt: {
            not: null,
            lte: startedAt,
          },
          ...(tenantId ? { tenantId } : {}),
        },
        orderBy: {
          retentionExpiresAt: 'asc',
        },
        take,
        include: {
          sourceRef: {
            select: {
              id: true,
              tenantId: true,
              storageStrategy: true,
              configuration: true,
            },
          },
        },
      });

      if (entries.length === 0) {
        break;
      }

      batches += 1;

      entries.forEach((entry) => {
        if (entry.sourceId) {
          sourcesTouched.add(entry.sourceId);
        }
      });

      if (dryRun) {
        deletedCount += entries.length;
        continue;
      }

      for (const entry of entries) {
        if (!entry.storageKey || !entry.sourceRef) {
          continue;
        }

        try {
          const adapter = getStorageAdapterForSource({
            id: entry.sourceRef.id,
            tenantId: entry.sourceRef.tenantId,
            storageStrategy: entry.sourceRef.storageStrategy,
            configuration: normalizeStorageConfiguration(entry.sourceRef.configuration),
          });

          if (adapter.removeChunk) {
            await adapter.removeChunk({
              tenantId: entry.tenantId,
              sourceId: entry.sourceRef.id,
              chunkId: entry.id,
              storageKey: entry.storageKey,
            });
          }
        } catch (error) {
          errors += 1;
          skippedCount += 1;
          retentionLogger.error('Failed to remove knowledge entry from external storage', {
            entryId: entry.id,
            sourceId: entry.sourceId,
            tenantId: entry.tenantId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const deletable = entries
        .filter((entry) => !entry.storageKey || entry.sourceRef || dryRun)
        .map((entry) => entry.id);

      if (deletable.length === 0) {
        retentionLogger.warn('No deletable entries after storage cleanup attempt', {
          tenantId,
        });
        break;
      }

      const deleteResult = await this.prisma.knowledgeEntry.deleteMany({
        where: {
          id: {
            in: deletable,
          },
        },
      });

      deletedCount += deleteResult.count;
    }

    if (!dryRun) {
      clearStorageAdapterCache();
    }

    const completedAt = this.now().toISOString();
    const hasMore = await this.prisma.knowledgeEntry.count({
      where: {
        retentionExpiresAt: {
          not: null,
          lte: this.now(),
        },
        ...(tenantId ? { tenantId } : {}),
      },
      take: 1,
    }) > 0;

    const result: RetentionJobResult = {
      deletedCount,
      skippedCount,
      batches,
      dryRun,
      sourcesTouched: sourcesTouched.size,
      errors,
      completedAt,
      hasMore,
    };

    retentionLogger.info('Knowledge retention sweep completed', {
      ...result,
      tenantId: tenantId ?? 'all-tenants',
      startedAt: startedAt.toISOString(),
    });

    return result;
  }
}
