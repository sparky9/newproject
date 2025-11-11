import { PrismaClient } from '@ocsuite/db';
import type { KnowledgeStorageStrategy } from '@ocsuite/types';
import { decryptForTenantWithVersion } from '@ocsuite/crypto';

import { logger } from '../utils/logger.js';
import { parseJsonRecord } from '../utils/json.js';
import {
  EXTERNAL_CONTENT_PLACEHOLDER,
  getStorageAdapterForSource,
  normalizeStorageConfiguration,
  postgresStorageAdapter,
  type KnowledgeSourceStorageDescriptor,
  type StorageAdapter,
} from './knowledge-storage.js';
import { KNOWLEDGE_ENCRYPTION_CONTEXT } from './knowledge-constants.js';

interface KnowledgeSearchRow {
  id: string;
  tenantId: string | null;
  source: string;
  sourceId: string | null;
  sourceName: string | null;
  sourceTenantId: string | null;
  storageStrategy: KnowledgeStorageStrategy | null;
  configuration: unknown;
  content: string;
  encryptionKeyVersion: number;
  metadata: unknown;
  checksum: string | null;
  chunkSize: number | null;
  tokenCount: number | null;
  embeddingMetadata: unknown;
  storageKey: string | null;
  retentionExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  distance: number | null;
}

export interface KnowledgeSearchOptions {
  embedding: number[];
  limit?: number;
  minScore?: number;
  persona?: string;
  sourceIds?: string[];
}

export interface KnowledgeSearchResultEntry {
  id: string;
  tenantId: string | null;
  source: string;
  sourceId: string | null;
  sourceName: string | null;
  metadata: Record<string, unknown> | null;
  checksum: string | null;
  chunkSize: number | null;
  tokenCount: number | null;
  embeddingMetadata: Record<string, unknown> | null;
  storageKey: string | null;
  retentionExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeSearchResult {
  entry: KnowledgeSearchResultEntry;
  content: string;
  score: number;
}

export interface KnowledgeRetrievalServiceOptions {
  prisma: PrismaClient;
  tenantId: string | null;
  userId?: string;
  defaultLimit?: number;
  storageAdapterFactory?: (source: KnowledgeSourceStorageDescriptor) => StorageAdapter | null;
}

export class KnowledgeRetrievalService {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string | null;
  private readonly userId?: string;
  private readonly defaultLimit: number;
  private readonly storageAdapterFactory?: (source: KnowledgeSourceStorageDescriptor) => StorageAdapter | null;
  private readonly storageAdapterCache = new Map<string, StorageAdapter>();

  constructor(options: KnowledgeRetrievalServiceOptions) {
    this.prisma = options.prisma;
    this.tenantId = options.tenantId ?? null;
    this.userId = options.userId;
    this.defaultLimit = options.defaultLimit ?? 8;
    this.storageAdapterFactory = options.storageAdapterFactory;
  }

  async searchByEmbedding(options: KnowledgeSearchOptions): Promise<KnowledgeSearchResult[]> {
    if (!options.embedding.length) {
      return [];
    }

    const limit = Math.max(1, Math.min(options.limit ?? this.defaultLimit, 50));
    const fetchLimit = Math.min(limit * 4, 100);
    const numericVector = options.embedding.map((value) =>
      Number.isFinite(value) ? Number(value) : 0,
    );
    const vectorLiteral = `[${numericVector.join(',')}]`;
    const sourceIds = options.sourceIds?.filter((id) => !!id) ?? [];

    let rows: KnowledgeSearchRow[];
    if (this.tenantId) {
      rows = await this.prisma.$queryRaw<KnowledgeSearchRow[]>`
        SELECT
          e."id",
          e."tenantId",
          e."source",
          e."sourceId",
          e."content",
          e."encryption_key_version" AS "encryptionKeyVersion",
          e."metadata",
          e."checksum",
          e."chunk_size" AS "chunkSize",
          e."token_count" AS "tokenCount",
          e."embedding_metadata" AS "embeddingMetadata",
          e."storage_key" AS "storageKey",
          e."retention_expires_at" AS "retentionExpiresAt",
          e."createdAt",
          e."updatedAt",
          s."name" AS "sourceName",
          s."tenantId" AS "sourceTenantId",
          s."storage_strategy" AS "storageStrategy",
          s."configuration",
          (e."embedding" <-> to_pgvector(${vectorLiteral})) AS "distance"
        FROM knowledge_entries e
        LEFT JOIN knowledge_sources s ON s."id" = e."sourceId"
        WHERE e."embedding" IS NOT NULL
          AND (e."tenantId" = ${this.tenantId} OR e."tenantId" IS NULL)
        ORDER BY e."embedding" <-> to_pgvector(${vectorLiteral})
        LIMIT ${fetchLimit}
      `;
    } else {
      rows = await this.prisma.$queryRaw<KnowledgeSearchRow[]>`
        SELECT
          e."id",
          e."tenantId",
          e."source",
          e."sourceId",
          e."content",
          e."encryption_key_version" AS "encryptionKeyVersion",
          e."metadata",
          e."checksum",
          e."chunk_size" AS "chunkSize",
          e."token_count" AS "tokenCount",
          e."embedding_metadata" AS "embeddingMetadata",
          e."storage_key" AS "storageKey",
          e."retention_expires_at" AS "retentionExpiresAt",
          e."createdAt",
          e."updatedAt",
          s."name" AS "sourceName",
          s."tenantId" AS "sourceTenantId",
          s."storage_strategy" AS "storageStrategy",
          s."configuration",
          (e."embedding" <-> to_pgvector(${vectorLiteral})) AS "distance"
        FROM knowledge_entries e
        LEFT JOIN knowledge_sources s ON s."id" = e."sourceId"
        WHERE e."embedding" IS NOT NULL
        ORDER BY e."embedding" <-> to_pgvector(${vectorLiteral})
        LIMIT ${fetchLimit}
      `;
    }

    const results: KnowledgeSearchResult[] = [];
    for (const row of rows) {
      if (sourceIds.length && (!row.sourceId || !sourceIds.includes(row.sourceId))) {
        continue;
      }
  const metadata = row.metadata ? parseJsonRecord(row.metadata as never) : null;

      if (options.persona) {
        const personas = Array.isArray(metadata?.personas)
          ? (metadata?.personas as unknown[]).filter((item): item is string => typeof item === 'string')
          : [];
        if (personas.length && !personas.includes(options.persona)) {
          continue;
        }
      }

      const decrypted = await this.resolveContent(row);
      if (!decrypted) {
        continue;
      }

      const score = this.calculateScore(row.distance);
      if (typeof options.minScore === 'number' && score < options.minScore) {
        continue;
      }

      const embeddingMetadata = row.embeddingMetadata
        ? parseJsonRecord(row.embeddingMetadata as never)
        : null;

      results.push({
        entry: {
          id: row.id,
          tenantId: row.tenantId,
          source: row.source,
          sourceId: row.sourceId,
          sourceName: row.sourceName,
          metadata,
          checksum: row.checksum,
          chunkSize: row.chunkSize,
          tokenCount: row.tokenCount,
          embeddingMetadata,
          storageKey: row.storageKey,
          retentionExpiresAt: row.retentionExpiresAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        content: decrypted,
        score,
      });
      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  private calculateScore(distance: number | null): number {
    if (distance === null || Number.isNaN(distance)) {
      return 1;
    }
    const normalized = 1 / (1 + Math.max(distance, 0));
    return Number.isFinite(normalized) ? normalized : 0;
  }

  private async resolveContent(row: KnowledgeSearchRow): Promise<string | null> {
    let encryptedContent = row.content;

    if (
      encryptedContent === EXTERNAL_CONTENT_PLACEHOLDER &&
      row.storageKey &&
      row.storageStrategy === 'external_s3' &&
      row.sourceId
    ) {
      const adapter = this.resolveStorageAdapter({
        id: row.sourceId,
        tenantId: row.sourceTenantId,
        storageStrategy: row.storageStrategy,
        configuration: normalizeStorageConfiguration(row.configuration),
      });

      if (!adapter?.fetchChunk) {
        logger.warn('Storage adapter missing fetchChunk implementation', {
          sourceId: row.sourceId,
          tenantId: this.tenantId ?? 'hq',
        });
        return null;
      }

      try {
        const payload = await adapter.fetchChunk({
          tenantId: row.tenantId,
          sourceId: row.sourceId,
          storageKey: row.storageKey,
        });
        encryptedContent = payload.encrypted;
      } catch (error) {
        logger.error('Failed to fetch knowledge chunk from external storage', {
          entryId: row.id,
          sourceId: row.sourceId,
          storageKey: row.storageKey,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }
    }

    const tenantForDecryption = row.tenantId ?? 'company_hq';
    try {
      const keyVersion =
        typeof row.encryptionKeyVersion === 'number' && Number.isFinite(row.encryptionKeyVersion)
          ? row.encryptionKeyVersion
          : 1;
      return decryptForTenantWithVersion(
        encryptedContent,
        tenantForDecryption,
        KNOWLEDGE_ENCRYPTION_CONTEXT,
        keyVersion
      );
    } catch (error) {
      logger.error('Failed to decrypt knowledge chunk', {
        entryId: row.id,
        tenantId: tenantForDecryption,
        userId: this.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private resolveStorageAdapter(source: KnowledgeSourceStorageDescriptor): StorageAdapter | null {
    if (!source.id) {
      return null;
    }

    if (this.storageAdapterFactory) {
      const adapter = this.storageAdapterFactory(source);
      if (adapter) {
        return adapter;
      }
    }

    if (source.storageStrategy === 'managed_postgres') {
      return postgresStorageAdapter;
    }

    const cached = this.storageAdapterCache.get(source.id);
    if (cached) {
      return cached;
    }

    try {
      const adapter = getStorageAdapterForSource(source);
      this.storageAdapterCache.set(source.id, adapter);
      return adapter;
    } catch (error) {
      logger.error('Failed to resolve storage adapter for knowledge source', {
        sourceId: source.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}
