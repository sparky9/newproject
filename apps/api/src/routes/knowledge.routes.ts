import { Router as createRouter } from 'express';
import type { Router, Request, Response } from 'express';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import JSZip from 'jszip';
import type {
  KnowledgeRetentionPolicy,
  KnowledgeStorageStrategy,
} from '@ocsuite/types';
import { prisma } from '@ocsuite/db';

import { KnowledgeResolver } from '../services/knowledge-resolver.js';
import { KnowledgeIngestService } from '../services/knowledge-ingest.js';
import {
  KnowledgeAdminService,
  type KnowledgeSourceSummary,
} from '../services/knowledge-admin.js';
import { generateEmbeddings } from '../services/llm/embedding-client.js';
import { apiLogger } from '../utils/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';

const router: Router = createRouter();

const RETENTION_POLICIES = ['retain_indefinitely', 'rolling_90_days', 'manual_purge'] as const satisfies readonly KnowledgeRetentionPolicy[];
const STORAGE_STRATEGIES = ['managed_postgres', 'external_s3'] as const satisfies readonly KnowledgeStorageStrategy[];

const uploadSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  content: z.string().min(1),
  personas: z.array(z.string()).optional(),
  shareWithHq: z.boolean().optional(),
  retentionPolicy: z.enum(RETENTION_POLICIES).optional(),
  storageStrategy: z.enum(STORAGE_STRATEGIES).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const manualNoteSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  personas: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  shareWithHq: z.boolean().optional(),
  retentionPolicy: z.enum(RETENTION_POLICIES).optional(),
  metadata: z.record(z.unknown()).optional(),
});

type UploadRequestBody = z.infer<typeof uploadSchema>;
type ManualNoteRequestBody = z.infer<typeof manualNoteSchema>;

const sourceIdParamSchema = z.object({
  id: z.string().min(1),
});

function sanitizeFileName(value: string, fallback: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s._-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return base || fallback;
}

function padIndex(index: number): string {
  return index.toString().padStart(3, '0');
}

router.get(
  '/sources',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const admin = new KnowledgeAdminService({
        prisma,
        tenantId,
        actorId: req.clerkId ?? undefined,
      });

      const sources = await admin.listSources();
      const totals = sources.reduce(
        (acc, source) => {
          acc.sources += 1;
          acc.entries += source.stats.entryCount;
          acc.tokens += source.stats.tokenCount;
          return acc;
        },
        { sources: 0, entries: 0, tokens: 0 },
      );

      res.status(200).json({ sources, totals });
    } catch (error) {
      apiLogger.error('Failed to list knowledge sources', {
        tenantId: req.tenantId,
        userId: req.clerkId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Failed to list knowledge sources' });
    }
  },
);

router.get(
  '/sources/:id',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const paramsResult = sourceIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: 'Invalid source id parameter' });
      return;
    }

    try {
      const tenantId = req.tenantId!;
  const admin = new KnowledgeAdminService({ prisma, tenantId, actorId: req.clerkId ?? undefined });
      const sources = await admin.listSources();
      const summary = sources.find((source) => source.id === paramsResult.data.id);

      if (!summary) {
        res.status(404).json({ error: 'Knowledge source not found' });
        return;
      }

      const rawLimitValue = Array.isArray(req.query.limit)
        ? req.query.limit[0]
        : req.query.limit;
      const parsedLimit = typeof rawLimitValue === 'string'
        ? Number.parseInt(rawLimitValue, 10)
        : Number.NaN;
      const limit = Number.isNaN(parsedLimit)
        ? 50
        : Math.min(Math.max(parsedLimit, 1), 200);
      const entries = await admin.getEntryPreviews(summary.id, limit);

      res.status(200).json({ source: summary, entries });
    } catch (error) {
      apiLogger.error('Failed to fetch knowledge source detail', {
        tenantId: req.tenantId,
        userId: req.clerkId,
        sourceId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Failed to fetch knowledge source' });
    }
  },
);

router.post(
  '/upload',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.flatten(),
      });
      return;
    }

    const {
      filename,
      mimeType,
      content,
      personas,
      shareWithHq,
      retentionPolicy,
      storageStrategy,
      metadata,
    }: UploadRequestBody = parsed.data;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(content, 'base64');
      if (!buffer.length) {
        throw new Error('Decoded buffer is empty');
      }
    } catch (error) {
      res.status(400).json({
        error: 'Invalid file content. Expected base64-encoded payload.',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }

    try {
      const ingest = new KnowledgeIngestService({
        prisma,
        tenantId: req.tenantId!,
        userId: req.clerkId ?? undefined,
      });

      const summary = await ingest.ingestFileUpload({
        filename,
        mimeType,
        buffer,
        personas,
        shareWithHq,
        retentionPolicy,
        storageStrategy,
        metadata,
      });

      res.status(201).json({ summary });
    } catch (error) {
      apiLogger.error('Knowledge upload failed', {
        tenantId: req.tenantId,
        userId: req.clerkId,
        filename,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Knowledge upload failed' });
    }
  },
);

router.post(
  '/notes',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const parsed = manualNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.flatten(),
      });
      return;
    }

    const {
      title,
      content,
      personas,
      tags,
      shareWithHq,
      retentionPolicy,
      metadata,
    }: ManualNoteRequestBody = parsed.data;

    try {
      const ingest = new KnowledgeIngestService({
        prisma,
        tenantId: req.tenantId!,
        userId: req.clerkId ?? undefined,
      });

      const summary = await ingest.ingestManualNote({
        title,
        content,
        personas,
        tags,
        shareWithHq,
        retentionPolicy,
        metadata,
      });

      res.status(201).json({ summary });
    } catch (error) {
      apiLogger.error('Manual note ingestion failed', {
        tenantId: req.tenantId,
        userId: req.clerkId,
        title,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Manual note ingestion failed' });
    }
  },
);

router.delete(
  '/sources/:id',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const paramsResult = sourceIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: 'Invalid source id parameter' });
      return;
    }

    try {
      const admin = new KnowledgeAdminService({
        prisma,
        tenantId: req.tenantId!,
        actorId: req.clerkId ?? undefined,
      });

  await admin.deleteSource(paramsResult.data.id);

  res.status(200).json({ success: true });
    } catch (error) {
      if ((error as { code?: string }).code === 'KNOWLEDGE_SOURCE_NOT_FOUND') {
        res.status(404).json({ error: 'Knowledge source not found' });
        return;
      }

      apiLogger.error('Failed to delete knowledge source', {
        tenantId: req.tenantId,
        userId: req.clerkId,
        sourceId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Failed to delete knowledge source' });
    }
  },
);

router.get(
  '/sources/:id/export',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const paramsResult = sourceIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: 'Invalid source id parameter' });
      return;
    }

    try {
      const tenantId = req.tenantId!;
  const admin = new KnowledgeAdminService({ prisma, tenantId, actorId: req.clerkId ?? undefined });
      const payload = await admin.exportSource(paramsResult.data.id);

      const zip = new JSZip();
      const summary: KnowledgeSourceSummary = payload.source;

      zip.file(
        'metadata.json',
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            source: summary,
            entryCount: payload.entries.length,
          },
          null,
          2,
        ),
      );

      payload.entries.forEach((entry, index) => {
        const label = typeof entry.metadata?.documentTitle === 'string'
          ? entry.metadata.documentTitle
          : `entry-${index + 1}`;
        const filename = `${padIndex(index + 1)}-${sanitizeFileName(label, 'entry')}.txt`;
        zip.file(`entries/${filename}`, entry.content, {
          date: entry.updatedAt,
        });
      });

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });

      res.setHeader('Content-Type', 'application/zip');
      const downloadName = `knowledge-${sanitizeFileName(summary.name, summary.id)}.zip`;
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.status(200).send(buffer);
    } catch (error) {
      if ((error as { code?: string }).code === 'KNOWLEDGE_SOURCE_NOT_FOUND') {
        res.status(404).json({ error: 'Knowledge source not found' });
        return;
      }

      apiLogger.error('Failed to export knowledge source', {
        tenantId: req.tenantId,
        userId: req.clerkId,
        sourceId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Failed to export knowledge source' });
    }
  },
);

router.post(
  '/search',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const {
      query,
      embedding,
      persona,
      sourceIds,
      limit = 8,
    } = req.body ?? {};

    const tenantId = req.tenantId ?? null;
    const userId = req.clerkId ?? undefined;

    const sourceIdFilter = Array.isArray(sourceIds)
      ? sourceIds.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
      : undefined;

    const safeLimit = typeof limit === 'number' && Number.isFinite(limit) ? limit : 8;

    let vector: number[] | undefined;
    if (Array.isArray(embedding) && embedding.every((value) => typeof value === 'number')) {
      vector = embedding as number[];
    }

    if (!vector) {
      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Either embedding array or query text is required' });
        return;
      }

      try {
        const embeddings = await generateEmbeddings({
          inputs: [query],
          tenantId,
          userId,
        });
        [vector] = embeddings.vectors;
      } catch (error) {
        apiLogger.error('Embedding generation failed for knowledge search', {
          tenantId: tenantId ?? 'hq',
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        res.status(500).json({ error: 'Embedding generation failed' });
        return;
      }
    }

    if (!vector || !vector.length) {
      res.status(200).json({ results: [] });
      return;
    }

    try {
      const resolver = new KnowledgeResolver({
        prisma,
        tenantId,
        userId,
      });

      const results = await resolver.resolveContext({
        embedding: vector,
        persona: typeof persona === 'string' ? persona : undefined,
        sourceIds: sourceIdFilter,
        limit: safeLimit,
      });

      res.status(200).json({ results });
    } catch (error) {
      apiLogger.error('Knowledge search failed', {
        tenantId: tenantId ?? 'hq',
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Knowledge search failed' });
    }
  },
);

export default router;
