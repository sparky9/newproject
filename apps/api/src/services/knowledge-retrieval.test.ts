import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KnowledgeRetrievalService } from './knowledge-retrieval.js';
import type { KnowledgeStorageStrategy } from '@ocsuite/types';

const decryptForTenantWithVersionMock = vi.hoisted(() =>
  vi.fn((cipher: string) => `decrypted::${cipher}`)
);
vi.mock('@ocsuite/crypto', () => ({
  decryptForTenantWithVersion: decryptForTenantWithVersionMock,
}));

const loggerMock = vi.hoisted(() => {
  const base = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => base),
  };
  return base;
});
vi.mock('../utils/logger.js', () => ({
  logger: loggerMock,
  createContextLogger: vi.fn(() => loggerMock),
}));

interface PrismaStub {
  $queryRaw: ReturnType<typeof vi.fn>;
}

function createPrismaStub(rows: unknown[]): PrismaStub {
  return {
    $queryRaw: vi.fn(async () => rows),
  };
}

beforeEach(() => {
  decryptForTenantWithVersionMock
    .mockReset()
    .mockImplementation((cipher: string) => `decrypted::${cipher}`);
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  loggerMock.debug.mockReset();
  loggerMock.child.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('KnowledgeRetrievalService', () => {
  it('hydrates external storage content and decrypts payload', async () => {
    const fetchChunk = vi.fn(async () => ({ encrypted: 'ciphertext' }));
    const storageAdapterFactory = () => ({
      storeChunk: vi.fn(async () => ({ storageKey: null })),
      fetchChunk,
    });

    const prisma = createPrismaStub([
      {
        id: 'entry-1',
        tenantId: 'tenant-123',
        source: 'Manual: Strategy',
        sourceId: 'source-1',
        sourceName: 'Manual: Strategy',
        sourceTenantId: 'tenant-123',
        storageStrategy: 'external_s3' as KnowledgeStorageStrategy,
        configuration: {},
        content: '__external_storage__',
        metadata: { personas: ['ceo'] },
        checksum: 'abc',
        chunkSize: 1200,
        tokenCount: 300,
        embeddingMetadata: { model: 'test' },
        storageKey: 'tenant-123/source-1/chunk-1.json',
        retentionExpiresAt: null,
        createdAt: new Date('2025-11-01T00:00:00Z'),
        updatedAt: new Date('2025-11-01T01:00:00Z'),
        distance: 0.1,
      },
    ]);

    const service = new KnowledgeRetrievalService({
      prisma: prisma as unknown as any,
      tenantId: 'tenant-123',
      storageAdapterFactory,
    });

    const results = await service.searchByEmbedding({ embedding: [0.1, 0.2, 0.3], limit: 1 });

  expect(results).toHaveLength(1);
  const result = results[0]!;
  expect(result.content).toBe('decrypted::ciphertext');
  expect(result.entry.metadata).toMatchObject({ personas: ['ceo'] });
    expect(fetchChunk).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      sourceId: 'source-1',
      storageKey: 'tenant-123/source-1/chunk-1.json',
    });
    expect(decryptForTenantWithVersionMock).toHaveBeenCalledWith(
      'ciphertext',
      'tenant-123',
      'knowledge_entry',
      1
    );
  });

  it('filters results by persona and source ids', async () => {
    const prisma = createPrismaStub([
      {
        id: 'entry-1',
        tenantId: 'tenant-123',
        source: 'Doc 1',
        sourceId: 'source-1',
        sourceName: 'Doc 1',
        sourceTenantId: 'tenant-123',
        storageStrategy: 'managed_postgres' as KnowledgeStorageStrategy,
        configuration: {},
        content: 'cipher-one',
        metadata: { personas: ['cfo', 'ceo'] },
        checksum: null,
        chunkSize: null,
        tokenCount: null,
        embeddingMetadata: null,
        storageKey: null,
        retentionExpiresAt: null,
        createdAt: new Date('2025-11-01T00:00:00Z'),
        updatedAt: new Date('2025-11-01T01:00:00Z'),
        distance: 0.05,
      },
      {
        id: 'entry-2',
        tenantId: 'tenant-123',
        source: 'Doc 2',
        sourceId: 'source-2',
        sourceName: 'Doc 2',
        sourceTenantId: 'tenant-123',
        storageStrategy: 'managed_postgres' as KnowledgeStorageStrategy,
        configuration: {},
        content: 'cipher-two',
        metadata: { personas: ['cto'] },
        checksum: null,
        chunkSize: null,
        tokenCount: null,
        embeddingMetadata: null,
        storageKey: null,
        retentionExpiresAt: null,
        createdAt: new Date('2025-11-01T00:00:00Z'),
        updatedAt: new Date('2025-11-01T01:00:00Z'),
        distance: 0.2,
      },
    ]);

  decryptForTenantWithVersionMock.mockImplementation((cipher: string) => `plain::${cipher}`);

    const service = new KnowledgeRetrievalService({
      prisma: prisma as unknown as any,
      tenantId: 'tenant-123',
    });

    const results = await service.searchByEmbedding({
      embedding: [0.2, 0.3, 0.4],
      limit: 5,
      persona: 'cfo',
      sourceIds: ['source-1'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.entry.id).toBe('entry-1');
    expect(results[0]?.content).toBe('plain::cipher-one');
  });
});
