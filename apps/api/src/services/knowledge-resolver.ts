import { PrismaClient } from '@ocsuite/db';

import {
  KnowledgeRetrievalService,
  type KnowledgeRetrievalServiceOptions,
  type KnowledgeSearchOptions,
  type KnowledgeSearchResult,
} from './knowledge-retrieval.js';

interface KnowledgeResolverOptions {
  prisma: PrismaClient;
  tenantId: string | null;
  userId?: string;
  defaultLimit?: number;
  storageAdapterFactory?: KnowledgeRetrievalServiceOptions['storageAdapterFactory'];
}

/**
 * High-level helper that wraps KnowledgeRetrievalService and exposes
 * a simple `resolveContext` entry point for RAG consumers.
 */
export class KnowledgeResolver {
  private readonly retrieval: KnowledgeRetrievalService;

  constructor(options: KnowledgeResolverOptions) {
    this.retrieval = new KnowledgeRetrievalService({
      prisma: options.prisma,
      tenantId: options.tenantId,
      userId: options.userId,
      defaultLimit: options.defaultLimit,
      storageAdapterFactory: options.storageAdapterFactory,
    });
  }

  async resolveContext(options: KnowledgeSearchOptions): Promise<KnowledgeSearchResult[]> {
    return this.retrieval.searchByEmbedding(options);
  }
}

export type { KnowledgeSearchResult };