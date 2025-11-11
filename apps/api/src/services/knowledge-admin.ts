import { Prisma } from '@prisma/client';
import { PrismaClient } from '@ocsuite/db';
import {
  KnowledgeRetentionPolicy,
  KnowledgeSourceProvider,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  KnowledgeStorageStrategy,
} from '@ocsuite/types';
import { decryptForTenantWithVersion } from '@ocsuite/crypto';

import { createContextLogger } from '../utils/logger.js';
import { parseJsonRecord } from '../utils/json.js';
import {
  KNOWLEDGE_ENCRYPTION_CONTEXT,
} from './knowledge-constants.js';
import {
  EXTERNAL_CONTENT_PLACEHOLDER,
  clearStorageAdapterCache,
  getStorageAdapterForSource,
  normalizeStorageConfiguration,
  postgresStorageAdapter,
  type KnowledgeSourceStorageDescriptor,
  type StorageAdapter,
} from './knowledge-storage.js';
import { recordKnowledgeAuditEvent } from './knowledge-audit.js';

const adminLogger = createContextLogger('knowledge-admin');

export interface KnowledgeSourceStats {
  entryCount: number;
  tokenCount: number;
  lastUpdatedAt: Date | null;
  personas: string[];
  tags: string[];
}

export interface KnowledgeSourceSummary {
  id: string;
  tenantId: string | null;
  scope: 'tenant' | 'hq';
  name: string;
  type: KnowledgeSourceType;
  provider: KnowledgeSourceProvider;
  status: KnowledgeSourceStatus;
  storageStrategy: KnowledgeStorageStrategy;
  retentionPolicy: KnowledgeRetentionPolicy;
  configuration: Record<string, unknown> | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  stats: KnowledgeSourceStats;
}

export interface KnowledgeEntryExport {
  id: string;
  tenantId: string | null;
  sourceId: string | null;
  checksum: string | null;
  metadata: Record<string, unknown> | null;
  encryptionKeyVersion: number | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeEntryPreview {
  id: string;
  tenantId: string | null;
  sourceId: string | null;
  metadata: Record<string, unknown> | null;
  personas: string[];
  tags: string[];
  preview: string;
  encryptionKeyVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeSourceExportPayload {
  source: KnowledgeSourceSummary;
  entries: KnowledgeEntryExport[];
}

interface KnowledgeAdminServiceOptions {
  prisma: PrismaClient;
  tenantId: string;
  actorId?: string;
}

export class KnowledgeAdminService {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string;
  private readonly actorId?: string;
  private readonly storageAdapterCache = new Map<string, StorageAdapter>();

  constructor(options: KnowledgeAdminServiceOptions) {
    this.prisma = options.prisma;
    this.tenantId = options.tenantId;
    this.actorId = options.actorId;
  }

  async listSources(): Promise<KnowledgeSourceSummary[]> {
    const sources = await this.prisma.knowledgeSource.findMany({
      where: {
        tenantId: this.tenantId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!sources.length) {
      return [];
    }

    const sourceIds = sources.map((source) => source.id);

    const [aggregateRows, metadataRows] = await Promise.all([
      this.prisma.knowledgeEntry.groupBy({
        by: ['sourceId'],
        where: {
          sourceId: { in: sourceIds },
        },
        _count: {
          _all: true,
        },
        _sum: {
          tokenCount: true,
        },
        _max: {
          updatedAt: true,
        },
      }),
      this.prisma.$queryRaw<Array<{ sourceId: string; personas: string[]; tags: string[] }>>`
        SELECT
          e."sourceId" AS "sourceId",
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT persona.value), NULL) AS personas,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT tag.value), NULL) AS tags
        FROM knowledge_entries e
        LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(e.metadata -> 'personas', '[]'::jsonb)) persona(value) ON TRUE
        LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(e.metadata -> 'tags', '[]'::jsonb)) tag(value) ON TRUE
        WHERE e."sourceId" IN (${Prisma.join(sourceIds)})
        GROUP BY e."sourceId"
      `,
    ]);

    const aggregatesBySource = new Map<string, (typeof aggregateRows)[number]>();
    aggregateRows.forEach((row) => aggregatesBySource.set(row.sourceId ?? '', row));

    const metadataBySource = new Map<string, { personas: string[]; tags: string[] }>();
    metadataRows.forEach((row) => {
      metadataBySource.set(row.sourceId, {
        personas: row.personas?.filter((value) => !!value) ?? [],
        tags: row.tags?.filter((value) => !!value) ?? [],
      });
    });

    return sources.map((source) => {
      const aggregates = aggregatesBySource.get(source.id);
      const metadata = metadataBySource.get(source.id);

      const stats: KnowledgeSourceStats = {
        entryCount: aggregates?._count?._all ?? 0,
        tokenCount: aggregates?._sum?.tokenCount ?? 0,
        lastUpdatedAt: aggregates?._max?.updatedAt ?? source.updatedAt,
        personas: metadata?.personas ?? [],
        tags: metadata?.tags ?? [],
      };

      return this.buildSummary(source, stats);
    });
  }

  async deleteSource(sourceId: string): Promise<void> {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: {
        id: sourceId,
        tenantId: this.tenantId,
      },
      include: {
        entries: {
          select: {
            id: true,
            storageKey: true,
            tenantId: true,
          },
        },
      },
    });

    if (!source) {
      throw Object.assign(new Error('Knowledge source not found'), {
        code: 'KNOWLEDGE_SOURCE_NOT_FOUND',
      });
    }

    const storageAdapter = this.resolveStorageAdapter({
      id: source.id,
      tenantId: source.tenantId,
      storageStrategy: source.storageStrategy,
      configuration: normalizeStorageConfiguration(source.configuration),
    });

    let storageFailures = 0;

    if (storageAdapter && typeof storageAdapter.removeChunk === 'function') {
      const removeChunk = storageAdapter.removeChunk.bind(storageAdapter);
      await Promise.all(
        source.entries
          .filter((entry) => entry.storageKey)
          .map((entry) =>
            removeChunk({
                tenantId: entry.tenantId,
                sourceId: source.id,
                chunkId: entry.id,
                storageKey: entry.storageKey!,
              })
              .catch((error) => {
                storageFailures += 1;
                adminLogger.warn('Failed to remove chunk from external storage during source deletion', {
                  sourceId: source.id,
                  chunkId: entry.id,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
              })
          )
      );
    }

    const deleteResult = await this.prisma.knowledgeEntry.deleteMany({
      where: { sourceId: source.id },
    });

    await recordKnowledgeAuditEvent({
      prisma: this.prisma,
      tenantId: this.tenantId,
      sourceId: source.id,
      sourceName: source.name,
      actorId: this.actorId,
      event: 'delete',
      summary: `Deleted knowledge source "${source.name}" and removed ${deleteResult.count} entr${deleteResult.count === 1 ? 'y' : 'ies'}`,
      entryCount: deleteResult.count,
      metadata: {
        storageStrategy: source.storageStrategy,
        retentionPolicy: source.retentionPolicy,
        deletedEntryIds: source.entries.map((entry) => entry.id),
        storageFailures,
      },
    });

    await this.prisma.knowledgeSource.delete({
      where: { id: source.id },
    });

    this.storageAdapterCache.delete(source.id);
    clearStorageAdapterCache(source.id);

    adminLogger.info('Knowledge source deleted', {
      sourceId: source.id,
      tenantId: this.tenantId,
    });
  }

  async exportSource(sourceId: string): Promise<KnowledgeSourceExportPayload> {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: {
        id: sourceId,
        tenantId: this.tenantId,
      },
    });

    if (!source) {
      throw Object.assign(new Error('Knowledge source not found'), {
        code: 'KNOWLEDGE_SOURCE_NOT_FOUND',
      });
    }

    const stats = await this.computeSourceStats(source.id);
    const summary = this.buildSummary(source, stats);
    const entries = await this.fetchEntriesForExport(source);

    await recordKnowledgeAuditEvent({
      prisma: this.prisma,
      tenantId: this.tenantId,
      sourceId: summary.id,
      sourceName: summary.name,
      actorId: this.actorId,
      event: 'export',
      summary: `Exported ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from "${summary.name}"`,
      entryCount: entries.length,
      metadata: {
        storageStrategy: summary.storageStrategy,
        retentionPolicy: summary.retentionPolicy,
        entryIds: entries.map((entry) => entry.id),
        personas: summary.stats.personas,
        tags: summary.stats.tags,
      },
    });

    return {
      source: summary,
      entries,
    };
  }

  async getEntryPreviews(sourceId: string, limit = 50): Promise<KnowledgeEntryPreview[]> {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: {
        id: sourceId,
        tenantId: this.tenantId,
      },
    });

    if (!source) {
      throw Object.assign(new Error('Knowledge source not found'), {
        code: 'KNOWLEDGE_SOURCE_NOT_FOUND',
      });
    }

    const rows = await this.prisma.knowledgeEntry.findMany({
      where: { sourceId: source.id },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
      select: {
        id: true,
        tenantId: true,
        sourceId: true,
        content: true,
        metadata: true,
        storageKey: true,
        encryptionKeyVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!rows.length) {
      return [];
    }

    const adapter = this.resolveStorageAdapter({
      id: source.id,
      tenantId: source.tenantId,
      storageStrategy: source.storageStrategy,
      configuration: normalizeStorageConfiguration(source.configuration),
    });

    const previews: KnowledgeEntryPreview[] = [];
    for (const row of rows) {
      const plaintext = await this.resolveContent({
        adapter,
        sourceId: source.id,
        tenantId: row.tenantId,
        storageStrategy: source.storageStrategy,
        storageKey: row.storageKey,
        content: row.content,
        encryptionKeyVersion: row.encryptionKeyVersion,
        entryId: row.id,
      });

      if (!plaintext) {
        continue;
      }

      const metadata = row.metadata ? parseJsonRecord(row.metadata as never) : null;
      const personas = Array.isArray(metadata?.personas)
        ? metadata?.personas.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      const tags = Array.isArray(metadata?.tags)
        ? metadata?.tags.filter((value: unknown): value is string => typeof value === 'string')
        : [];

      const preview = plaintext.length > 400 ? `${plaintext.slice(0, 397)}...` : plaintext;

      previews.push({
        id: row.id,
        tenantId: row.tenantId,
        sourceId: row.sourceId,
        metadata,
        personas,
        tags,
        preview,
        encryptionKeyVersion: row.encryptionKeyVersion ?? 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    return previews;
  }

  private async computeSourceStats(sourceId: string): Promise<KnowledgeSourceStats> {
    const [aggregate] = await this.prisma.knowledgeEntry.groupBy({
      by: ['sourceId'],
      where: { sourceId },
      _count: { _all: true },
      _sum: { tokenCount: true },
      _max: { updatedAt: true },
    });

    const [metadata] = await this.prisma.$queryRaw<Array<{ personas: string[]; tags: string[] }>>`
      SELECT
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT persona.value), NULL) AS personas,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT tag.value), NULL) AS tags
      FROM knowledge_entries e
      LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(e.metadata -> 'personas', '[]'::jsonb)) persona(value) ON TRUE
      LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(e.metadata -> 'tags', '[]'::jsonb)) tag(value) ON TRUE
      WHERE e."sourceId" = ${sourceId}
    `;

    return {
      entryCount: aggregate?._count?._all ?? 0,
      tokenCount: aggregate?._sum?.tokenCount ?? 0,
      lastUpdatedAt: aggregate?._max?.updatedAt ?? null,
      personas: metadata?.personas?.filter((value) => !!value) ?? [],
      tags: metadata?.tags?.filter((value) => !!value) ?? [],
    };
  }

  private async fetchEntriesForExport(source: {
    id: string;
    tenantId: string | null;
    storageStrategy: KnowledgeStorageStrategy;
    configuration: Prisma.JsonValue | null;
  }): Promise<KnowledgeEntryExport[]> {
    const rows = await this.prisma.knowledgeEntry.findMany({
      where: { sourceId: source.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        tenantId: true,
        sourceId: true,
        content: true,
        metadata: true,
        checksum: true,
        storageKey: true,
        encryptionKeyVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!rows.length) {
      return [];
    }

    const adapter = this.resolveStorageAdapter({
      id: source.id,
      tenantId: source.tenantId,
      storageStrategy: source.storageStrategy,
      configuration: normalizeStorageConfiguration(source.configuration),
    });

    const entries: KnowledgeEntryExport[] = [];
    for (const row of rows) {
      const plaintext = await this.resolveContent({
        adapter,
        sourceId: source.id,
        tenantId: row.tenantId,
        storageStrategy: source.storageStrategy,
        storageKey: row.storageKey,
        content: row.content,
        encryptionKeyVersion: row.encryptionKeyVersion,
        entryId: row.id,
      });

      if (!plaintext) {
        continue;
      }

      const metadata = row.metadata ? parseJsonRecord(row.metadata as never) : null;

      entries.push({
        id: row.id,
        tenantId: row.tenantId,
        sourceId: row.sourceId,
        checksum: row.checksum,
        metadata,
        encryptionKeyVersion: row.encryptionKeyVersion ?? 1,
        content: plaintext,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    return entries;
  }

  private buildSummary(
    source: {
      id: string;
      tenantId: string | null;
      name: string;
      type: KnowledgeSourceType;
      provider: KnowledgeSourceProvider;
      status: KnowledgeSourceStatus;
      storageStrategy: KnowledgeStorageStrategy;
      retentionPolicy: KnowledgeRetentionPolicy;
      configuration: Prisma.JsonValue | null;
      lastSyncedAt: Date | null;
      lastError: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    stats: KnowledgeSourceStats,
  ): KnowledgeSourceSummary {
    return {
      id: source.id,
      tenantId: source.tenantId,
      scope: source.tenantId ? 'tenant' : 'hq',
      name: source.name,
      type: source.type,
      provider: source.provider,
      status: source.status,
      storageStrategy: source.storageStrategy,
      retentionPolicy: source.retentionPolicy,
      configuration: normalizeStorageConfiguration(source.configuration),
      lastSyncedAt: source.lastSyncedAt,
      lastError: source.lastError,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      stats,
    };
  }

  private resolveStorageAdapter(source: KnowledgeSourceStorageDescriptor): StorageAdapter {
    if (source.storageStrategy === 'managed_postgres') {
      return postgresStorageAdapter;
    }

    const cached = this.storageAdapterCache.get(source.id);
    if (cached) {
      return cached;
    }

    const adapter = getStorageAdapterForSource(source);
    this.storageAdapterCache.set(source.id, adapter);
    return adapter;
  }

  private async resolveContent(params: {
    adapter: StorageAdapter;
    sourceId: string;
    storageStrategy: KnowledgeStorageStrategy;
    storageKey: string | null;
    tenantId: string | null;
    content: string;
    encryptionKeyVersion: number | null;
    entryId: string;
  }): Promise<string | null> {
    let encryptedContent = params.content;

    if (
      encryptedContent === EXTERNAL_CONTENT_PLACEHOLDER &&
      params.storageStrategy === 'external_s3' &&
      params.storageKey
    ) {
      if (!params.adapter.fetchChunk) {
        adminLogger.warn('Storage adapter missing fetchChunk during export', {
          sourceId: params.sourceId,
          entryId: params.entryId,
        });
        return null;
      }

      try {
        const payload = await params.adapter.fetchChunk({
          tenantId: params.tenantId,
          sourceId: params.sourceId,
          storageKey: params.storageKey,
        });
        encryptedContent = payload.encrypted;
      } catch (error) {
        adminLogger.error('Failed to fetch external storage chunk during export', {
          sourceId: params.sourceId,
          entryId: params.entryId,
          storageKey: params.storageKey,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }
    }

    const tenantForDecryption = params.tenantId ?? 'company_hq';
    const keyVersion = params.encryptionKeyVersion ?? 1;

    try {
      return decryptForTenantWithVersion(
        encryptedContent,
        tenantForDecryption,
        KNOWLEDGE_ENCRYPTION_CONTEXT,
        keyVersion,
      );
    } catch (error) {
      adminLogger.error('Failed to decrypt knowledge entry during export', {
        sourceId: params.sourceId,
        entryId: params.entryId,
        tenantId: tenantForDecryption,
        encryptionKeyVersion: keyVersion,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}
