import { Router as createRouter } from 'express';
import type { Request, Response, Router } from 'express';
import { ZodError } from 'zod';
import { videoProductionService } from '../services/video-production.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { apiLogger } from '../utils/logger.js';
import {
  TranscribeRequestSchema,
  ExtractClipsRequestSchema,
  RenderVideoRequestSchema,
  AddCaptionsRequestSchema,
  OptimizeVideoRequestSchema,
} from '@ocsuite/video-core';

const router: Router = createRouter();

// All routes require authentication and tenant context
router.use(requireAuth());
router.use(resolveTenant());

/**
 * POST /video/transcribe
 * Transcribe a video or audio file
 */
router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.clerkId;

    if (!tenantId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = TranscribeRequestSchema.parse(req.body);

    const job = await videoProductionService.transcribeMedia(
      body.url,
      tenantId,
      userId,
      {
        language: body.language,
        speakerLabels: body.speakerLabels,
      }
    );

    apiLogger.info(`Transcription job created: ${job.id}`, { tenantId, userId });

    res.status(201).json(job);
  } catch (error: unknown) {
    apiLogger.error('Transcribe endpoint error:', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
    }

    res.status(500).json({
      error: 'Failed to start transcription',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /video/extract-clips
 * Extract viral clips from a transcript
 */
router.post('/extract-clips', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.clerkId;

    if (!tenantId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = ExtractClipsRequestSchema.parse(req.body);

    const job = await videoProductionService.extractViralClips(
      body.transcriptId,
      tenantId,
      userId,
      {
        count: body.count,
        minDuration: body.minDuration,
        maxDuration: body.maxDuration,
      }
    );

    apiLogger.info(`Clip extraction completed: ${job.id}`, { tenantId, userId });

    res.status(200).json(job);
  } catch (error: unknown) {
    apiLogger.error('Extract clips endpoint error:', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
    }

    res.status(500).json({
      error: 'Failed to extract clips',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /video/render
 * Render a video from composition
 */
router.post('/render', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.clerkId;

    if (!tenantId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = RenderVideoRequestSchema.parse(req.body);

    // First create composition
    const compositionJob = await videoProductionService.createComposition(
      body.composition,
      tenantId,
      userId
    );

    // Then start render
    const renderJob = await videoProductionService.renderVideo(
      compositionJob.id,
      tenantId,
      userId
    );

    apiLogger.info(`Render job created: ${renderJob.id}`, { tenantId, userId });

    res.status(201).json(renderJob);
  } catch (error: unknown) {
    apiLogger.error('Render endpoint error:', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
    }

    res.status(500).json({
      error: 'Failed to start render',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /video/add-captions
 * Add captions to a video
 */
router.post('/add-captions', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.clerkId;

    if (!tenantId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = AddCaptionsRequestSchema.parse(req.body);

    const job = await videoProductionService.addCaptions(
      body.videoUrl,
      body.transcriptId,
      tenantId,
      userId,
      body.style
    );

    apiLogger.info(`Caption job created: ${job.id}`, { tenantId, userId });

    res.status(201).json(job);
  } catch (error: unknown) {
    apiLogger.error('Add captions endpoint error:', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
    }

    res.status(500).json({
      error: 'Failed to add captions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /video/optimize
 * Optimize video for a platform
 */
router.post('/optimize', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.clerkId;

    if (!tenantId || !userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = OptimizeVideoRequestSchema.parse(req.body);

    const job = await videoProductionService.optimizeForPlatform(
      body.videoUrl,
      body.platform,
      tenantId,
      userId
    );

    apiLogger.info(`Optimization job created: ${job.id}`, {
      tenantId,
      userId,
      platform: body.platform,
    });

    res.status(201).json(job);
  } catch (error: unknown) {
    apiLogger.error('Optimize endpoint error:', error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
    }

    res.status(500).json({
      error: 'Failed to optimize video',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /video/jobs
 * List all video jobs for tenant
 */
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { type, status, limit, offset } = req.query;

    const result = await videoProductionService.listJobs(tenantId, {
      type: type as string | undefined,
      status: status as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    apiLogger.error('List jobs endpoint error:', error);

    res.status(500).json({
      error: 'Failed to list jobs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /video/jobs/:id
 * Get job status
 */
router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const jobId = req.params?.id;

    if (!jobId) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const job = await videoProductionService.getJob(jobId, tenantId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.status(200).json(job);
  } catch (error: unknown) {
    apiLogger.error('Get job endpoint error:', error);

    res.status(500).json({
      error: 'Failed to get job',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /video/jobs/:id
 * Cancel/delete a job
 */
router.delete('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const jobId = req.params?.id;

    if (!jobId) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    await videoProductionService.deleteJob(jobId, tenantId);

    apiLogger.info(`Job deleted: ${jobId}`, { tenantId });

    res.status(204).send();
  } catch (error: unknown) {
    apiLogger.error('Delete job endpoint error:', error);

    res.status(500).json({
      error: 'Failed to delete job',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
