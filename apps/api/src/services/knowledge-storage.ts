import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import type { KnowledgeStorageStrategy } from '@ocsuite/types';

import { createContextLogger } from '../utils/logger.js';

const storageLogger = createContextLogger('knowledge-storage');

export const EXTERNAL_CONTENT_PLACEHOLDER = '__external_storage__';

export interface StorageAdapterStoreParams {
  tenantId: string | null;
  sourceId: string;
  chunkId: string;
  plaintext: string;
  encrypted: string;
}

export interface StorageAdapterStoreResult {
  storageKey: string | null;
}

export interface StorageAdapterRemoveParams {
  tenantId: string | null;
  sourceId: string;
  chunkId: string;
  storageKey: string;
}

export interface StorageAdapter {
  storeChunk(params: StorageAdapterStoreParams): Promise<StorageAdapterStoreResult>;
  fetchChunk?(params: StorageAdapterFetchParams): Promise<StorageAdapterFetchResult>;
  removeChunk?(params: StorageAdapterRemoveParams): Promise<void>;
}

export interface StorageAdapterFetchParams {
  tenantId: string | null;
  sourceId: string;
  storageKey: string;
}

export interface StorageAdapterFetchResult {
  encrypted: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeSourceStorageDescriptor {
  id: string;
  tenantId: string | null;
  storageStrategy: KnowledgeStorageStrategy;
  configuration: Record<string, unknown> | null;
}

export class PostgresStorageAdapter implements StorageAdapter {
  async storeChunk(_params: StorageAdapterStoreParams): Promise<StorageAdapterStoreResult> {
    // Content is persisted directly in Postgres, nothing additional to store.
    return { storageKey: null };
  }
}

const postgresStorageAdapterInstance = new PostgresStorageAdapter();

const credentialsSchema = z
  .object({
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    sessionToken: z.string().min(1).optional(),
  })
  .optional();

const s3ConfigSchema = z.object({
  bucket: z.string().min(1),
  region: z.string().min(1),
  prefix: z.string().optional(),
  endpoint: z.string().url().optional(),
  forcePathStyle: z.boolean().optional(),
  credentials: credentialsSchema,
  serverSideEncryption: z.enum(['AES256', 'aws:kms']).optional(),
  kmsKeyId: z.string().optional(),
});

export type S3StorageConfiguration = z.infer<typeof s3ConfigSchema>;

export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfiguration) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: config.credentials
        ? {
            accessKeyId: config.credentials.accessKeyId,
            secretAccessKey: config.credentials.secretAccessKey,
            sessionToken: config.credentials.sessionToken,
          }
        : undefined,
    });
  }

  async storeChunk(params: StorageAdapterStoreParams): Promise<StorageAdapterStoreResult> {
    const key = this.buildObjectKey(params);

    const payload = JSON.stringify({
      encrypted: params.encrypted,
      tenantId: params.tenantId,
      sourceId: params.sourceId,
      chunkId: params.chunkId,
      storedAt: new Date().toISOString(),
    });

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: payload,
      ContentType: 'application/json',
      ServerSideEncryption: this.config.serverSideEncryption,
      SSEKMSKeyId: this.config.kmsKeyId,
    });

    await this.client.send(command);

    storageLogger.debug('Stored chunk in external storage', {
      bucket: this.config.bucket,
      key,
      tenantId: params.tenantId ?? 'hq',
      sourceId: params.sourceId,
    });

    return { storageKey: key };
  }

  async fetchChunk(params: StorageAdapterFetchParams): Promise<StorageAdapterFetchResult> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: params.storageKey,
    });

    const response = await this.client.send(command);
    const body = await response.Body?.transformToString();

    if (!body) {
      storageLogger.warn('Fetched empty payload from external storage', {
        bucket: this.config.bucket,
        key: params.storageKey,
        tenantId: params.tenantId ?? 'hq',
        sourceId: params.sourceId,
      });
      throw new Error('External storage returned empty payload');
    }

    let parsed: { encrypted?: string; metadata?: Record<string, unknown> };
    try {
      parsed = JSON.parse(body) as { encrypted?: string; metadata?: Record<string, unknown> };
    } catch (error) {
      storageLogger.error('Failed to parse external storage payload', {
        bucket: this.config.bucket,
        key: params.storageKey,
        tenantId: params.tenantId ?? 'hq',
        sourceId: params.sourceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Invalid external storage payload');
    }

    if (!parsed.encrypted) {
      storageLogger.error('External storage payload missing encrypted content', {
        bucket: this.config.bucket,
        key: params.storageKey,
        tenantId: params.tenantId ?? 'hq',
        sourceId: params.sourceId,
      });
      throw new Error('External storage payload missing encrypted content');
    }

    return {
      encrypted: parsed.encrypted,
      metadata: parsed.metadata,
    };
  }

  async removeChunk(params: StorageAdapterRemoveParams): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: params.storageKey,
    });

    await this.client.send(command);

    storageLogger.debug('Removed chunk from external storage', {
      bucket: this.config.bucket,
      key: params.storageKey,
      tenantId: params.tenantId ?? 'hq',
      sourceId: params.sourceId,
    });
  }

  private buildObjectKey(params: StorageAdapterStoreParams): string {
    const parts = [
      this.config.prefix ?? 'knowledge',
      params.tenantId ?? 'hq',
      params.sourceId,
      `${params.chunkId}.json`,
    ];

    return parts
      .map((part) => part.replace(/^\/+/, '').replace(/\/+$/, ''))
      .filter((part) => part.length > 0)
      .join('/');
  }
}

const s3AdapterCache = new Map<string, S3StorageAdapter>();

export function normalizeStorageConfiguration(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseS3Configuration(
  sourceId: string,
  configuration: Record<string, unknown> | null
): S3StorageConfiguration {
  const result = s3ConfigSchema.safeParse(configuration ?? {});

  if (!result.success) {
    storageLogger.error('Invalid S3 storage configuration', {
      sourceId,
      issues: result.error.issues,
    });
    throw new Error('Invalid S3 storage configuration for knowledge source');
  }

  return result.data;
}

export function getStorageAdapterForSource(
  source: KnowledgeSourceStorageDescriptor
): StorageAdapter {
  switch (source.storageStrategy) {
    case 'managed_postgres':
      return postgresStorageAdapterInstance;
    case 'external_s3': {
      const parsedConfiguration = parseS3Configuration(source.id, source.configuration);
      const cacheKey = `${source.id}:${parsedConfiguration.bucket}:${parsedConfiguration.prefix ?? ''}`;
      const existingAdapter = s3AdapterCache.get(cacheKey);
      if (existingAdapter) {
        return existingAdapter;
      }
      const adapter = new S3StorageAdapter(parsedConfiguration);
      s3AdapterCache.set(cacheKey, adapter);
      return adapter;
    }
    default: {
      storageLogger.error('Unsupported storage strategy', {
        sourceId: source.id,
        storageStrategy: source.storageStrategy,
      });
      throw new Error(`Unsupported storage strategy: ${source.storageStrategy}`);
    }
  }
}

export function clearStorageAdapterCache(sourceId?: string): void {
  if (!sourceId) {
    s3AdapterCache.clear();
    return;
  }

  for (const key of s3AdapterCache.keys()) {
    if (key.startsWith(`${sourceId}:`)) {
      s3AdapterCache.delete(key);
    }
  }
}

export { postgresStorageAdapterInstance as postgresStorageAdapter };
