import { Prisma } from '@prisma/client';
import { PrismaClient } from '@ocsuite/db';
import type {
  KnowledgeRetentionPolicy,
  KnowledgeSourceProvider,
  KnowledgeSourceType,
  KnowledgeStorageStrategy,
} from '@ocsuite/types';
import { encryptForTenant, getCurrentKeyVersion } from '@ocsuite/crypto';
import { createHash, randomUUID } from 'node:crypto';
import type { Buffer } from 'node:buffer';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { estimateTokens } from './llm/fireworks-client.js';
import { generateEmbeddings } from './llm/embedding-client.js';
import {
  EXTERNAL_CONTENT_PLACEHOLDER,
  clearStorageAdapterCache,
  getStorageAdapterForSource,
  normalizeStorageConfiguration,
  postgresStorageAdapter,
  type KnowledgeSourceStorageDescriptor,
  type StorageAdapter,
} from './knowledge-storage.js';
import { KNOWLEDGE_ENCRYPTION_CONTEXT } from './knowledge-constants.js';
import { recordKnowledgeAuditEvent } from './knowledge-audit.js';
import { toInputJson } from '../utils/json.js';

const DEFAULT_CHUNK_SIZE = 1600;
const DEFAULT_CHUNK_OVERLAP = 200;

const JSON_NULL = (Prisma as unknown as { JsonNull: unknown }).JsonNull as Prisma.NullableJsonNullValueInput;

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface ChunkResult {
  id: string;
  content: string;
  chunkSize: number;
  tokenCount: number;
  checksum: string;
}

export interface KnowledgeIngestServiceOptions {
  prisma: PrismaClient;
  tenantId: string | null;
  userId?: string;
  defaultStorageStrategy?: KnowledgeStorageStrategy;
  defaultRetentionPolicy?: KnowledgeRetentionPolicy;
  storageAdapterFactory?: (source: KnowledgeSourceRecord) => StorageAdapter;
}

export interface IngestionSummary {
  sourceId: string;
  sourceName: string;
  chunkCount: number;
  createdEntryIds: string[];
  totalTokens: number;
  skippedChunks: number;
}

export interface ManualNoteInput {
  title: string;
  content: string;
  personas?: string[];
  tags?: string[];
  shareWithHq?: boolean;
  retentionPolicy?: KnowledgeRetentionPolicy;
  metadata?: Record<string, unknown>;
}

export interface FileUploadInput {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  personas?: string[];
  shareWithHq?: boolean;
  retentionPolicy?: KnowledgeRetentionPolicy;
  storageStrategy?: KnowledgeStorageStrategy;
  metadata?: Record<string, unknown>;
}

export interface ConnectorDocument {
  externalId: string;
  title: string;
  content: string;
  lastModifiedAt?: Date;
  personas?: string[];
  metadata?: Record<string, unknown>;
}

export interface ConnectorSyncInput {
  sourceName: string;
  provider: KnowledgeSourceProvider;
  documents: ConnectorDocument[];
  shareWithHq?: boolean;
  retentionPolicy?: KnowledgeRetentionPolicy;
  storageStrategy?: KnowledgeStorageStrategy;
  configuration?: Record<string, unknown>;
}

interface KnowledgeSourceRecord extends KnowledgeSourceStorageDescriptor {
  name: string;
  retentionPolicy: KnowledgeRetentionPolicy | null;
}

interface EnsureSourceOptions {
  name: string;
  type: KnowledgeSourceType;
  provider: KnowledgeSourceProvider;
  shareWithHq?: boolean;
  storageStrategy?: KnowledgeStorageStrategy;
  retentionPolicy?: KnowledgeRetentionPolicy;
  configuration?: Record<string, unknown> | null;
}

interface PersistableChunk {
  chunk: ChunkResult;
  contentValue: string;
  storageKey: string | null;
  metadata: Record<string, unknown> | null;
  embedding: number[] | null;
  retentionExpiresAt: Date | null;
}

function normalizeText(content: string): string {
  // Normalize line endings and strip null bytes without relying on control-char regexes
  const withoutWindowsBreaks = content.replace(/\r\n/g, '\n');
  const withoutNulls = withoutWindowsBreaks.split('\u0000').join('');
  return withoutNulls.trim();
}

function splitOversizedChunk(content: string, chunkSize: number, overlap: number): string[] {
  const segments: string[] = [];

  if (content.length <= chunkSize) {
    segments.push(content);
    return segments;
  }

  let position = 0;
  const step = Math.max(1, chunkSize - overlap);

  while (position < content.length) {
    const segment = content.slice(position, position + chunkSize);
    segments.push(segment.trim());
    if (position + chunkSize >= content.length) {
      break;
    }
    position += step;
  }

  return segments.filter((segment) => segment.length > 0);
}

export function chunkContent(text: string, options: ChunkOptions = {}): ChunkResult[] {
  const chunkSize = Math.max(200, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const chunkOverlap = Math.min(chunkSize - 1, options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP);

  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const chunks: ChunkResult[] = [];
  let buffer = '';

  const flushBuffer = () => {
    const trimmed = buffer.trim();
    if (!trimmed) {
      buffer = '';
      return;
    }

    if (trimmed.length > chunkSize) {
      const oversizedSegments = splitOversizedChunk(trimmed, chunkSize, chunkOverlap);
      oversizedSegments.forEach((segment) => {
        chunks.push(buildChunk(segment));
      });
    } else {
      chunks.push(buildChunk(trimmed));
    }
    buffer = '';
  };

  const buildChunk = (content: string): ChunkResult => {
    const tokenCount = estimateTokens(content);
    const checksum = createHash('sha256').update(content).digest('hex');
    return {
      id: randomUUID(),
      content,
      chunkSize: content.length,
      tokenCount,
      checksum,
    };
  };

  for (const paragraph of paragraphs) {
    if (!buffer) {
      buffer = paragraph;
      continue;
    }

    if (buffer.length + paragraph.length + 2 <= chunkSize) {
      buffer = `${buffer}\n\n${paragraph}`;
      continue;
    }

    flushBuffer();
    if (paragraph.length > chunkSize) {
      const segments = splitOversizedChunk(paragraph, chunkSize, chunkOverlap);
      segments.forEach((segment) => chunks.push(buildChunk(segment)));
    } else {
      buffer = paragraph;
    }
  }

  flushBuffer();

  return chunks;
}

function resolveRetentionDate(policy: KnowledgeRetentionPolicy | undefined): Date | null {
  if (!policy || policy === 'retain_indefinitely') {
    return null;
  }

  if (policy === 'rolling_90_days') {
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ninetyDaysMs);
  }

  // manual_purge is tenant-controlled, so no automatic expiration
  return null;
}

async function extractTextFromFile(input: FileUploadInput): Promise<string> {
  const { mimeType, buffer } = input;

  if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'application/json') {
    return buffer.toString('utf8');
  }

  if (mimeType === 'application/pdf') {
    const pdfModule = await import('pdf-parse');
    const pdfParse = pdfModule.default ?? pdfModule;
    const result = await pdfParse(buffer);
    return typeof result.text === 'string' ? result.text : '';
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammothModule = await import('mammoth');
    const mammoth = mammothModule.default ?? mammothModule;
    const result = await mammoth.extractRawText({ buffer });
    return typeof result.value === 'string' ? result.value : '';
  }

  throw new Error(`Unsupported file type for ingestion: ${mimeType}`);
}

function buildEmbeddingMetadata(model: string, dimensions: number, tokens: number) {
  return {
    provider: 'fireworks',
    model,
    dimensions,
    tokens,
    generatedAt: new Date().toISOString(),
  } satisfies Record<string, unknown>;
}

export class KnowledgeIngestService {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string | null;
  private readonly userId?: string;
  private readonly defaultStorageStrategy: KnowledgeStorageStrategy;
  private readonly defaultRetentionPolicy: KnowledgeRetentionPolicy;
  private readonly storageAdapterFactory?: (source: KnowledgeSourceRecord) => StorageAdapter;
  private readonly storageAdapterCache = new Map<string, StorageAdapter>();

  constructor(options: KnowledgeIngestServiceOptions) {
    this.prisma = options.prisma;
    this.tenantId = options.tenantId ?? null;
    this.userId = options.userId;
    this.defaultStorageStrategy = options.defaultStorageStrategy ?? 'managed_postgres';
    this.defaultRetentionPolicy = options.defaultRetentionPolicy ?? 'retain_indefinitely';
    this.storageAdapterFactory = options.storageAdapterFactory;
  }

  async ingestManualNote(input: ManualNoteInput): Promise<IngestionSummary> {
    const source = await this.ensureSource({
      name: `Manual: ${input.title}`,
      type: 'manual_note',
      provider: 'manual',
      shareWithHq: input.shareWithHq,
      retentionPolicy: input.retentionPolicy ?? this.defaultRetentionPolicy,
    });

    const normalizedText = normalizeText(input.content);
    const chunks = chunkContent(normalizedText);

    return this.ingestChunks(source, chunks, {
      personas: input.personas ?? [],
      tags: input.tags ?? [],
      documentTitle: input.title,
      metadata: input.metadata ?? {},
      retentionPolicy: input.retentionPolicy,
      replaceExistingByDocumentId: `manual-note:${source.id}`,
    });
  }

  async ingestFileUpload(input: FileUploadInput): Promise<IngestionSummary> {
    const source = await this.ensureSource({
      name: `Upload: ${input.filename}`,
      type: 'file_upload',
      provider: 'upload',
      shareWithHq: input.shareWithHq,
      storageStrategy: input.storageStrategy,
      retentionPolicy: input.retentionPolicy ?? this.defaultRetentionPolicy,
    });

    const extracted = await extractTextFromFile(input);
    const chunks = chunkContent(extracted);

    return this.ingestChunks(source, chunks, {
      personas: input.personas ?? [],
      metadata: {
        ...(input.metadata ?? {}),
        filename: input.filename,
        mimeType: input.mimeType,
      },
      retentionPolicy: input.retentionPolicy,
      replaceExistingByDocumentId: `file:${input.filename}`,
    });
  }

  async ingestConnectorDocuments(input: ConnectorSyncInput): Promise<IngestionSummary> {
    if (!input.documents.length) {
      return {
        sourceId: 'n/a',
        sourceName: input.sourceName,
        chunkCount: 0,
        createdEntryIds: [],
        totalTokens: 0,
        skippedChunks: 0,
      };
    }

    const source = await this.ensureSource({
      name: input.sourceName,
      type: 'cloud_sync',
      provider: input.provider,
      shareWithHq: input.shareWithHq,
      storageStrategy: input.storageStrategy,
      retentionPolicy: input.retentionPolicy ?? this.defaultRetentionPolicy,
      configuration: input.configuration ?? null,
    });

    const allChunks: ChunkResult[] = [];
    const personaMap = new Map<string, string[]>();
    const metadataMap = new Map<string, Record<string, unknown>>();

    input.documents.forEach((doc) => {
      const docChunks = chunkContent(doc.content);
      docChunks.forEach((chunk, index) => {
        personaMap.set(chunk.id, doc.personas ?? []);
        metadataMap.set(chunk.id, {
          ...(doc.metadata ?? {}),
          externalId: doc.externalId,
          documentTitle: doc.title,
          chunkIndex: index,
          lastModifiedAt: doc.lastModifiedAt?.toISOString(),
        });
      });
      allChunks.push(...docChunks);
    });

    return this.ingestChunks(source, allChunks, {
      personasByChunk: personaMap,
      metadataByChunk: metadataMap,
      retentionPolicy: input.retentionPolicy,
      replaceExistingByDocumentId: undefined,
    });
  }

  private async ingestChunks(
    source: Awaited<ReturnType<typeof this.ensureSource>>,
    chunks: ChunkResult[],
    options: {
      personas?: string[];
      personasByChunk?: Map<string, string[]>;
      metadata?: Record<string, unknown>;
      metadataByChunk?: Map<string, Record<string, unknown>>;
      documentTitle?: string;
      tags?: string[];
      retentionPolicy?: KnowledgeRetentionPolicy;
      replaceExistingByDocumentId?: string;
    }
  ): Promise<IngestionSummary> {
    const ingestionLogger = logger.child({
      context: 'knowledge-ingest',
      sourceId: source.id,
      tenantId: this.tenantId ?? 'hq',
    });

    const storageAdapter = this.resolveStorageAdapter(source);

    if (!chunks.length) {
      ingestionLogger.warn('No chunks to ingest for source');
      return {
        sourceId: source.id,
        sourceName: source.name,
        chunkCount: 0,
        createdEntryIds: [],
        totalTokens: 0,
        skippedChunks: 0,
      };
    }

    const retentionPolicy = options.retentionPolicy ?? source.retentionPolicy ?? this.defaultRetentionPolicy;
    const retentionExpiresAt = resolveRetentionDate(retentionPolicy);

    const payloads = await this.prepareChunksForPersistence(source, storageAdapter, chunks, {
      retentionExpiresAt,
      personas: options.personas,
      personasByChunk: options.personasByChunk,
      metadata: options.metadata,
      metadataByChunk: options.metadataByChunk,
      documentTitle: options.documentTitle,
      tags: options.tags,
    });

  const encryptionKeyVersion = getCurrentKeyVersion();

  return this.withSourceSync(source, async () => {
      let skippedChunks = 0;

      if (options.replaceExistingByDocumentId) {
        await this.prisma.knowledgeEntry.deleteMany({
          where: {
            sourceId: source.id,
            metadata: {
              path: ['documentId'],
              equals: options.replaceExistingByDocumentId,
            },
          },
        });
      }

      const nonNullChecksums = payloads
        .map((payload) => payload.chunk.checksum)
        .filter((checksum): checksum is string => Boolean(checksum));

      let existingChecksums = new Set<string>();
      if (nonNullChecksums.length) {
        const existing = await this.prisma.knowledgeEntry.findMany({
          where: {
            sourceId: source.id,
            checksum: { in: nonNullChecksums },
          },
          select: { checksum: true },
        });
        existingChecksums = new Set(
          existing
            .map((entry: { checksum: string | null }) => entry.checksum)
            .filter((checksum: string | null): checksum is string => Boolean(checksum))
        );
      }

      const entriesToPersist = payloads.filter((payload) => {
        if (payload.chunk.checksum && existingChecksums.has(payload.chunk.checksum)) {
          skippedChunks += 1;
          return false;
        }
        return true;
      });

      const createdEntries = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created: { id: string }[] = [];

        for (const payload of entriesToPersist) {
          const entry = await tx.knowledgeEntry.create({
            data: {
              tenantId: this.tenantId,
              source: source.name,
              sourceId: source.id,
              content: payload.contentValue,
              encryptionKeyVersion,
              metadata: payload.metadata ? toInputJson(payload.metadata) : JSON_NULL,
              checksum: payload.chunk.checksum,
              chunkSize: payload.chunk.chunkSize,
              tokenCount: payload.chunk.tokenCount,
              embeddingMetadata: payload.embedding
                ? toInputJson(
                    buildEmbeddingMetadata(
                      config.fireworks.embeddingModel,
                      config.fireworks.embeddingDimensions,
                      payload.chunk.tokenCount,
                    ),
                  )
                : JSON_NULL,
              storageKey: payload.storageKey,
              retentionExpiresAt: payload.retentionExpiresAt,
            },
          });

          if (payload.embedding && payload.embedding.length) {
            const numericVector = payload.embedding.map((value) =>
              Number.isFinite(value) ? Number(value) : 0,
            );
            const vectorLiteral = `[${numericVector.join(',')}]`;
            await tx.$executeRaw`
              UPDATE knowledge_entries
              SET embedding = to_pgvector(${vectorLiteral})
              WHERE id = ${entry.id}
            `;
          }

          created.push(entry);
        }

        return created;
      });

      ingestionLogger.info('Knowledge chunks ingested', {
        createdCount: createdEntries.length,
        skippedChunks,
      });

      const summary: IngestionSummary = {
        sourceId: source.id,
        sourceName: source.name,
        chunkCount: payloads.length,
        createdEntryIds: createdEntries.map((entry: { id: string }) => entry.id),
        totalTokens: payloads.reduce((sum, payload) => sum + payload.chunk.tokenCount, 0),
        skippedChunks,
      };

      const createdCount = summary.createdEntryIds.length;
      const summaryText = createdCount
        ? `Uploaded ${createdCount} knowledge entr${createdCount === 1 ? 'y' : 'ies'} for "${source.name}"` +
            (skippedChunks ? ` (${skippedChunks} duplicate chunk${skippedChunks === 1 ? '' : 's'} skipped)` : '')
        : `Processed knowledge upload for "${source.name}" with no new entries` +
            (skippedChunks ? ` (${skippedChunks} duplicate chunk${skippedChunks === 1 ? '' : 's'} skipped)` : '');

      await recordKnowledgeAuditEvent({
        prisma: this.prisma,
        tenantId: this.tenantId,
        sourceId: source.id,
        sourceName: source.name,
        actorId: this.userId,
        event: 'upload',
        summary: summaryText,
        entryCount: createdCount,
        metadata: {
          chunkCount: summary.chunkCount,
          createdEntryIds: summary.createdEntryIds,
          skippedChunks: summary.skippedChunks,
          totalTokens: summary.totalTokens,
          retentionPolicy,
          storageStrategy: source.storageStrategy,
          personas: options.personas ?? undefined,
          documentTitle: options.documentTitle,
          tags: options.tags,
          replaceExisting: Boolean(options.replaceExistingByDocumentId),
          replacedDocumentId: options.replaceExistingByDocumentId,
        },
      });

      return summary;
    });
  }

  private resolveStorageAdapter(source: KnowledgeSourceRecord): StorageAdapter {
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

    const adapter = getStorageAdapterForSource({
      id: source.id,
      tenantId: source.tenantId,
      storageStrategy: source.storageStrategy,
      configuration: source.configuration,
    });

    this.storageAdapterCache.set(source.id, adapter);
    return adapter;
  }

  private async ensureSource(options: EnsureSourceOptions): Promise<KnowledgeSourceRecord> {
    const tenantScope = options.shareWithHq ? null : this.tenantId;
    const storageStrategy = options.storageStrategy ?? this.defaultStorageStrategy;
    const retentionPolicy = options.retentionPolicy ?? this.defaultRetentionPolicy;
    const configurationProvided = Object.prototype.hasOwnProperty.call(options, 'configuration');

    const existing = await this.prisma.knowledgeSource.findFirst({
      where: {
        tenantId: tenantScope,
        name: options.name,
      },
    });

    if (existing) {
      const needsUpdate =
        existing.storageStrategy !== storageStrategy ||
        existing.retentionPolicy !== retentionPolicy ||
        existing.provider !== options.provider ||
        configurationProvided;

      if (needsUpdate) {
        const updated = await this.prisma.knowledgeSource.update({
          where: { id: existing.id },
          data: {
            ...(existing.storageStrategy !== storageStrategy ? { storageStrategy } : {}),
            ...(existing.retentionPolicy !== retentionPolicy ? { retentionPolicy } : {}),
            ...(existing.provider !== options.provider ? { provider: options.provider } : {}),
            ...(configurationProvided
              ? {
                  configuration: options.configuration
                    ? toInputJson(options.configuration)
                    : JSON_NULL,
                }
              : {}),
          },
        });

        this.storageAdapterCache.delete(updated.id);
        clearStorageAdapterCache(updated.id);

        return this.buildKnowledgeSourceRecord(updated);
      }

      return this.buildKnowledgeSourceRecord(existing);
    }

    const created = await this.prisma.knowledgeSource.create({
      data: {
        tenantId: tenantScope,
        name: options.name,
        type: options.type,
        provider: options.provider,
        status: 'pending',
        storageStrategy,
        retentionPolicy,
        configuration: options.configuration
          ? toInputJson(options.configuration)
          : JSON_NULL,
      },
    });

    return this.buildKnowledgeSourceRecord(created);
  }

  private buildKnowledgeSourceRecord(source: {
    id: string;
    name: string;
    tenantId: string | null;
    storageStrategy: string;
    retentionPolicy: KnowledgeRetentionPolicy | null | string;
    configuration: unknown;
  }): KnowledgeSourceRecord {
    return {
      id: source.id,
      name: source.name,
      tenantId: source.tenantId,
      storageStrategy: source.storageStrategy as KnowledgeStorageStrategy,
      retentionPolicy: (source.retentionPolicy as KnowledgeRetentionPolicy | null) ?? null,
      configuration: normalizeStorageConfiguration(source.configuration),
    };
  }

  private async withSourceSync<T>(source: { id: string }, handler: () => Promise<T>): Promise<T> {
    await this.prisma.knowledgeSource.update({
      where: { id: source.id },
      data: {
        status: 'syncing',
        lastError: null,
      },
    });

    try {
      const result = await handler();
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: {
          status: 'ready',
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ingestion error';
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: {
          status: 'error',
          lastError: message.slice(0, 1000),
        },
      });
      throw error;
    }
  }

  private async prepareChunksForPersistence(
    source: KnowledgeSourceRecord,
    storageAdapter: StorageAdapter,
    chunks: ChunkResult[],
    options: {
      retentionExpiresAt: Date | null;
      personas?: string[];
      personasByChunk?: Map<string, string[]>;
      metadata?: Record<string, unknown>;
      metadataByChunk?: Map<string, Record<string, unknown>>;
      documentTitle?: string;
      tags?: string[];
    }
  ): Promise<PersistableChunk[]> {
    const tenantForEncryption = this.tenantId ?? 'company_hq';
    const chunkPlaintexts = chunks.map((entry) => entry.content);

    const embeddings = await this.embedChunks(chunkPlaintexts);

    const embeddingsByChunk = new Map<string, number[]>();
    chunks.forEach((chunk, index) => {
      const vector = embeddings[index] ?? null;
      if (vector) {
        embeddingsByChunk.set(chunk.id, vector);
      }
    });

    const payloads: PersistableChunk[] = [];
    for (const chunk of chunks) {
      const metadata = this.buildMetadata(chunk.id, {
        source,
        baseMetadata: options.metadata,
        metadataByChunk: options.metadataByChunk,
        personas: options.personas,
        personasByChunk: options.personasByChunk,
        documentTitle: options.documentTitle,
        tags: options.tags,
      });

      const encryptedContent = encryptForTenant(chunk.content, tenantForEncryption, KNOWLEDGE_ENCRYPTION_CONTEXT);
      const storageResult = await storageAdapter.storeChunk({
        tenantId: this.tenantId,
        sourceId: source.id,
        chunkId: chunk.id,
        plaintext: chunk.content,
        encrypted: encryptedContent,
      });

      const storageKey = storageResult.storageKey ?? null;

      if (source.storageStrategy === 'external_s3' && !storageKey) {
        logger.warn('External storage did not return a storage key; falling back to managed storage', {
          tenantId: this.tenantId ?? 'hq',
          sourceId: source.id,
          chunkId: chunk.id,
        });
      }

      const contentValue =
        source.storageStrategy === 'external_s3' && storageKey
          ? EXTERNAL_CONTENT_PLACEHOLDER
          : encryptedContent;

      payloads.push({
        chunk,
        contentValue,
        storageKey,
        metadata,
        embedding: embeddingsByChunk.get(chunk.id) ?? null,
        retentionExpiresAt: options.retentionExpiresAt,
      });
    }

    return payloads;
  }

  private async embedChunks(chunks: string[]): Promise<number[][]> {
    if (!chunks.length) {
      return [];
    }

    try {
      const response = await generateEmbeddings({
        inputs: chunks,
        tenantId: this.tenantId,
        userId: this.userId,
      });
      return response.vectors;
    } catch (error) {
      logger.error('Embedding generation failed, falling back to empty vectors', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return chunks.map(() => []);
    }
  }

  private buildMetadata(
    chunkId: string,
    options: {
      source: KnowledgeSourceRecord;
      baseMetadata?: Record<string, unknown>;
      metadataByChunk?: Map<string, Record<string, unknown>>;
      personas?: string[];
      personasByChunk?: Map<string, string[]>;
      documentTitle?: string;
      tags?: string[];
    }
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      sourceId: options.source.id,
      sourceName: options.source.name,
      documentTitle: options.documentTitle,
      documentId: options.baseMetadata?.documentId,
      chunkId,
      personas: options.personas ?? [],
      tags: options.tags ?? [],
    };

    if (options.baseMetadata) {
      Object.assign(metadata, options.baseMetadata);
    }

    const chunkSpecificMetadata = options.metadataByChunk?.get(chunkId);
    if (chunkSpecificMetadata) {
      Object.assign(metadata, chunkSpecificMetadata);
    }

    const chunkPersonas = options.personasByChunk?.get(chunkId);
    if (chunkPersonas) {
      metadata.personas = chunkPersonas;
    }

    return metadata;
  }
}
