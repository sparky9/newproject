import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@ocsuite/db';
import { KnowledgeIngestService, chunkContent } from './knowledge-ingest.js';
import { EXTERNAL_CONTENT_PLACEHOLDER } from './knowledge-storage.js';
import type { KnowledgeStorageStrategy } from '@ocsuite/types';

// Mocks must be declared before the module under test is evaluated
const encryptForTenantMock = vi.hoisted(() =>
  vi.fn((plaintext: string) => `encrypted::${plaintext}`)
);
const getCurrentKeyVersionMock = vi.hoisted(() => vi.fn(() => 1));
vi.mock('@ocsuite/crypto', () => ({
  encryptForTenant: encryptForTenantMock,
  getCurrentKeyVersion: getCurrentKeyVersionMock,
}));

const generateEmbeddingsMock = vi.hoisted(() =>
  vi.fn(async ({ inputs }: { inputs: string[] }) => ({
    vectors: inputs.map(() => [0.11, 0.22, 0.33]),
    usage: { totalTokens: inputs.length, model: 'mock-embedding' },
  }))
);
vi.mock('./llm/embedding-client.js', () => ({
  generateEmbeddings: generateEmbeddingsMock,
  FireworksEmbeddingError: class extends Error {},
}));

vi.mock('../config/index.js', () => ({
  config: {
    fireworks: {
      embeddingModel: 'text-embedding-004',
      embeddingDimensions: 1536,
    },
  },
}));

const childLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../utils/logger.js', () => ({
  logger: {
    child: vi.fn(() => childLogger),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createContextLogger: vi.fn(() => childLogger),
}));

interface PrismaLike {
  knowledgeSource: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  knowledgeEntry: {
    deleteMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  knowledgeAuditEvent: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

function createPrismaMock() {
  const knowledgeSources = new Map<string, Record<string, unknown>>();
  const createdEntries: Array<Record<string, unknown>> = [];
  const embeddingUpdates: unknown[][] = [];
  const auditEvents: Array<Record<string, unknown>> = [];

  const transactionClient = {
    knowledgeEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `entry-${createdEntries.length + 1}`;
        createdEntries.push({ ...data, id });
        return { id };
      }),
    },
    $executeRaw: vi.fn(async (...args: unknown[]) => {
      embeddingUpdates.push(args as unknown[]);
      return 1;
    }),
  };

  const prismaImpl: PrismaLike = {
    knowledgeSource: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `source-${knowledgeSources.size + 1}`;
        const record = {
          id,
          name: data.name,
          tenantId: data.tenantId ?? null,
          type: data.type,
          provider: data.provider,
          status: data.status ?? 'pending',
          storageStrategy: data.storageStrategy,
          retentionPolicy: data.retentionPolicy ?? null,
          configuration: data.configuration ?? null,
        };
        knowledgeSources.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = knowledgeSources.get(where.id);
        if (!existing) {
          throw new Error(`Unknown knowledge source ${where.id}`);
        }
        const updated = { ...existing, ...data };
        knowledgeSources.set(where.id, updated);
        return updated;
      }),
    },
    knowledgeEntry: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
    knowledgeAuditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data);
        return { id: `audit-${auditEvents.length}`, ...data };
      }),
    },
    $transaction: vi.fn(async (handler: (tx: typeof transactionClient) => Promise<unknown>) => {
      return handler(transactionClient);
    }),
  };

  return {
    prisma: prismaImpl as unknown as PrismaClient,
    prismaImpl,
    transactionClient,
    createdEntries,
    embeddingUpdates,
    auditEvents,
  };
}

function createService(options?: {
  prisma?: PrismaClient;
  storageStrategy?: KnowledgeStorageStrategy;
  storageKey?: string | null;
}) {
  const { prisma, prismaImpl, transactionClient, createdEntries, embeddingUpdates, auditEvents } = createPrismaMock();
  const storageKey = options?.storageKey !== undefined ? options.storageKey : 'tenant-123/source-1/chunk-1.json';
  const storageAdapter = {
    storeChunk: vi.fn(async () => ({ storageKey })),
    removeChunk: vi.fn(async () => undefined),
  };

  const service = new KnowledgeIngestService({
    prisma: options?.prisma ?? prisma,
    tenantId: 'tenant-123',
    userId: 'user-789',
    defaultStorageStrategy: options?.storageStrategy ?? 'external_s3',
    storageAdapterFactory: () => storageAdapter,
  });

  return {
    service,
    storageAdapter,
    createdEntries,
    embeddingUpdates,
    prismaImpl,
    transactionClient,
    auditEvents,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-11-04T00:00:00.000Z'));
  generateEmbeddingsMock.mockClear();
  encryptForTenantMock.mockClear();
  childLogger.info.mockClear();
  childLogger.warn.mockClear();
  childLogger.error.mockClear();
  childLogger.debug.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('chunkContent', () => {
  it('returns empty array for blank input', () => {
    expect(chunkContent('   ')).toEqual([]);
  });

  it('splits oversized paragraph respecting chunk size and overlap', () => {
    const largeParagraph = 'A'.repeat(900);

    const chunks = chunkContent(largeParagraph, { chunkSize: 400, chunkOverlap: 50 });

    expect(chunks).toHaveLength(3);
    const first = chunks[0]!;
    const second = chunks[1]!;
    const third = chunks[2]!;

    expect(first.id).toBeTypeOf('string');
    expect(second.id).toBeTypeOf('string');
    expect(third.id).toBeTypeOf('string');
    expect(first.content.length).toBeLessThanOrEqual(400);
    expect(second.content.length).toBeLessThanOrEqual(400);
    expect(third.content.length).toBeLessThanOrEqual(400);

    const expectedChecksum = createHash('sha256').update(first.content).digest('hex');
    expect(first.checksum).toBe(expectedChecksum);
  });
});

describe('KnowledgeIngestService', () => {
  it('stores external content using placeholder when storage key is provided', async () => {
    const { service, storageAdapter, createdEntries, embeddingUpdates, prismaImpl, transactionClient, auditEvents } = createService();

    const summary = await service.ingestManualNote({
      title: 'Strategy Update',
      content: 'Paragraph 1\r\n\r\nParagraph 2',
      personas: ['ceo'],
      retentionPolicy: 'rolling_90_days',
    });

    expect(storageAdapter.storeChunk).toHaveBeenCalledTimes(1);
    const chunkCall = storageAdapter.storeChunk.mock.calls[0][0];
    expect(chunkCall.plaintext).toBe('Paragraph 1\n\nParagraph 2');
    expect(chunkCall.encrypted).toBe('encrypted::Paragraph 1\n\nParagraph 2');

    expect(createdEntries).toHaveLength(1);
    const persisted = createdEntries[0]!;
    expect(persisted.content).toBe(EXTERNAL_CONTENT_PLACEHOLDER);
    expect(persisted.storageKey).toBe('tenant-123/source-1/chunk-1.json');
    expect(persisted.metadata).toMatchObject({
      sourceName: 'Manual: Strategy Update',
      documentTitle: 'Strategy Update',
      personas: ['ceo'],
    });
    expect(typeof (persisted.metadata as Record<string, unknown>).chunkId).toBe('string');

    const expectedRetention = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    expect(persisted.retentionExpiresAt).toEqual(expectedRetention);

    expect(persisted.embeddingMetadata).toMatchObject({
      provider: 'fireworks',
      model: 'text-embedding-004',
      dimensions: 1536,
    });

    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(embeddingUpdates).toHaveLength(1);

    expect(summary.chunkCount).toBe(1);
    expect(summary.skippedChunks).toBe(0);
    expect(summary.createdEntryIds).toEqual(['entry-1']);

    expect(prismaImpl.knowledgeEntry.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaImpl.knowledgeSource.update).toHaveBeenCalledTimes(2);

    expect(prismaImpl.knowledgeAuditEvent.create).toHaveBeenCalledTimes(1);
    expect(auditEvents).toHaveLength(1);
    const auditPayload = prismaImpl.knowledgeAuditEvent.create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(auditPayload.event).toBe('upload');
    expect(auditPayload.entryCount).toBe(1);
    expect(auditPayload.actorId).toBe('user-789');
    expect(auditPayload.summary).toContain('Uploaded 1 knowledge entry');
  });

  it('falls back to encrypted content when storage key is missing', async () => {
    const { service, storageAdapter, createdEntries, transactionClient, prismaImpl, auditEvents } = createService({ storageKey: null });

    const summary = await service.ingestManualNote({
      title: 'No Key Note',
      content: 'Single paragraph only.',
    });

    expect(storageAdapter.storeChunk).toHaveBeenCalledTimes(1);
  const persisted = createdEntries[0]!;
    expect(persisted.content).toBe('encrypted::Single paragraph only.');
    expect(persisted.storageKey).toBeNull();
    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(summary.createdEntryIds).toEqual(['entry-1']);
    expect(prismaImpl.knowledgeAuditEvent.create).toHaveBeenCalledTimes(1);
    expect(auditEvents[0]?.event).toBe('upload');
  });

  it('handles embedding failures by skipping vector update', async () => {
    generateEmbeddingsMock.mockRejectedValueOnce(new Error('embedding failure'));

    const { service, createdEntries, embeddingUpdates, transactionClient, prismaImpl } = createService();

    await service.ingestManualNote({
      title: 'Embedding Failure Note',
      content: 'Failure case content.',
    });

  expect(createdEntries).toHaveLength(1);
  expect(createdEntries[0]).toBeDefined();
  expect(transactionClient.$executeRaw).not.toHaveBeenCalled();
    expect(embeddingUpdates).toHaveLength(0);

    expect(prismaImpl.knowledgeAuditEvent.create).toHaveBeenCalledTimes(1);

  });
});
