import { prisma as db, Prisma } from '@ocsuite/db';
import type { VideoJob, VideoTranscript } from '@ocsuite/db';
import {
  AssemblyAIClient,
  ShotstackClient,
  type VideoComposition,
  type ViralMoment,
  PLATFORM_SPECS,
  type PlatformType,
} from '@ocsuite/video-core';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { toInputJson } from '../utils/json.js';

type CaptionStyleOptions = {
  position?: 'top' | 'center' | 'bottom';
  fontSize?: string;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  highlightColor?: string;
};

type CaptionWord = { text: string; start: number; end: number };

type JsonValue = Prisma.JsonValue;
type JsonObject = Prisma.JsonObject;
type JsonArray = Prisma.JsonArray;

interface CompositionMetadata {
  composition: VideoComposition;
}

interface GeneratedClip {
  id: string;
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  duration: number;
  score: number;
  keywords: string[];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

function parseCaptionWords(wordsJson: JsonValue | null): CaptionWord[] {
  if (!Array.isArray(wordsJson)) {
    return [];
  }

  return wordsJson
    .filter((entry): entry is JsonObject => isJsonObject(entry))
    .map((entry) => {
      const textValue = entry['text'];
      const startValue = entry['start'];
      const endValue = entry['end'];

      const text = typeof textValue === 'string' ? textValue : undefined;
      const start = typeof startValue === 'number' ? startValue : undefined;
      const end = typeof endValue === 'number' ? endValue : undefined;

      if (!text || start === undefined || end === undefined) {
        return null;
      }

      return { text, start, end } satisfies CaptionWord;
    })
    .filter((entry): entry is CaptionWord => entry !== null);
}

function parseViralMoments(value: JsonValue | null): ViralMoment[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const moments = value
    .filter((entry): entry is JsonObject => isJsonObject(entry))
    .map((entry) => {
      const titleValue = entry['title'];
      const descriptionValue = entry['description'];
      const startValue = entry['start'];
      const endValue = entry['end'];
      const scoreValue = entry['score'];
      const keywordsValue = entry['keywords'];
      const sentimentValue = entry['sentiment'];

      const title = typeof titleValue === 'string' ? titleValue : undefined;
      const description =
        typeof descriptionValue === 'string' ? descriptionValue : undefined;
      const start = typeof startValue === 'number' ? startValue : undefined;
      const end = typeof endValue === 'number' ? endValue : undefined;
      const score = typeof scoreValue === 'number' ? scoreValue : undefined;
      const keywords = Array.isArray(keywordsValue)
        ? (keywordsValue as JsonArray).filter(
            (keyword): keyword is string => typeof keyword === 'string',
          )
        : undefined;

      if (!title || !description || start === undefined || end === undefined || score === undefined) {
        return null;
      }

      const moment: ViralMoment = {
        title,
        description,
        start,
        end,
        score,
        keywords: keywords ?? [],
      };

      if (typeof sentimentValue === 'string') {
        moment.sentiment = sentimentValue;
      }

      return moment;
    })
    .filter((entry): entry is ViralMoment => entry !== null);

  return moments.length ? moments : null;
}

function extractComposition(value: JsonValue | null): VideoComposition | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const compositionValue = value['composition'];
  if (isJsonObject(compositionValue)) {
    return compositionValue as unknown as VideoComposition;
  }

  return null;
}

function parseOutputUrls(value: JsonValue | null): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const urls = value.filter((entry): entry is string => typeof entry === 'string');
  return urls.length ? urls : undefined;
}

export const videoProductionInternals = {
  getErrorMessage,
  parseCaptionWords,
  parseViralMoments,
  extractComposition,
  parseOutputUrls,
};

export interface VideoJobResult {
  id: string;
  type: string;
  status: string;
  progress: number;
  outputUrls?: string[];
  transcriptId?: string;
  error?: string;
}

export class VideoProductionService {
  private assemblyAI: AssemblyAIClient;
  private shotstack: ShotstackClient;

  constructor() {
    // Initialize clients with API keys from environment
    this.assemblyAI = new AssemblyAIClient({
      apiKey: config.assemblyAIApiKey || '',
    });

    this.shotstack = new ShotstackClient({
      apiKey: config.shotstackApiKey || '',
      environment: config.nodeEnv === 'production' ? 'production' : 'stage',
    });
  }

  /**
   * Transcribe media (audio/video) to text with AI analysis
   */
  async transcribeMedia(
    url: string,
    tenantId: string,
    userId: string,
    options: {
      language?: string;
      speakerLabels?: boolean;
    } = {}
  ): Promise<VideoJobResult> {
    try {
      // Create initial job record
      const job = await db.videoJob.create({
        data: {
          tenantId,
          type: 'transcribe',
          status: 'pending',
          inputUrl: url,
          createdBy: userId,
          metadata: {
            language: options.language,
            speakerLabels: options.speakerLabels,
          },
        },
      });

      logger.info(`Created transcription job ${job.id} for tenant ${tenantId}`);

      // Start transcription (async)
      this.processTranscription(job.id, url, options).catch((err) => {
        logger.error(`Transcription job ${job.id} failed:`, err);
      });

      return this.mapJobToResult(job);
    } catch (error) {
      logger.error('Failed to start transcription:', error);
      throw error;
    }
  }

  /**
   * Background processing for transcription
   */
  private async processTranscription(
    jobId: string,
    url: string,
    options: {
      language?: string;
      speakerLabels?: boolean;
    }
  ): Promise<void> {
    try {
      // Update job to processing
      await db.videoJob.update({
        where: { id: jobId },
        data: { status: 'processing', progress: 10 },
      });

      // Start transcription
      const { transcriptId } = await this.assemblyAI.transcribe(url, {
        language: options.language,
        speakerLabels: options.speakerLabels,
      });

      await db.videoJob.update({
        where: { id: jobId },
        data: { transcriptId, progress: 30 },
      });

      // Wait for completion
      const transcriptData = await this.assemblyAI.waitForTranscript(transcriptId);

      await db.videoJob.update({
        where: { id: jobId },
        data: { progress: 80 },
      });

      // Store transcript in database
      const job = await db.videoJob.findUnique({ where: { id: jobId } });
      if (!job) throw new Error('Job not found');

      await db.videoTranscript.create({
        data: {
          id: transcriptId,
          tenantId: job.tenantId,
          jobId: job.id,
          assemblyAiId: transcriptId,
          content: transcriptData.text,
          words: transcriptData.words ? toInputJson(transcriptData.words) : undefined,
          speakers: transcriptData.speakers
            ? toInputJson(transcriptData.speakers)
            : undefined,
          viralMoments: transcriptData.viralMoments
            ? toInputJson(transcriptData.viralMoments)
            : undefined,
          metadata: toInputJson({
            duration: transcriptData.duration,
            language: transcriptData.language,
          }),
        },
      });

      // Mark job as completed
      await db.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          progress: 100,
          completedAt: new Date(),
        },
      });

      logger.info(`Transcription job ${jobId} completed successfully`);
    } catch (error: unknown) {
      logger.error(`Transcription job ${jobId} failed:`, error);

      await db.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: getErrorMessage(error),
        },
      });
    }
  }

  /**
   * Extract viral clips from a transcript
   */
  async extractViralClips(
    transcriptId: string,
    tenantId: string,
    userId: string,
    options: {
      count?: number;
      minDuration?: number;
      maxDuration?: number;
    } = {}
  ): Promise<VideoJobResult> {
    try {
      const transcript = await db.videoTranscript.findUnique({
        where: { id: transcriptId },
      });

      if (!transcript || transcript.tenantId !== tenantId) {
        throw new Error('Transcript not found');
      }

      const clipMetadata = this.extractClipsFromTranscript(
        parseViralMoments(transcript.viralMoments),
        options
      );

      // Create job record
      const job = await db.videoJob.create({
        data: {
          tenantId,
          type: 'extract_clips',
          status: 'completed',
          inputUrl: '',
          transcriptId,
          createdBy: userId,
          progress: 100,
          completedAt: new Date(),
          metadata: toInputJson({
            clips: clipMetadata,
          }),
        },
      });

      logger.info(`Extracted clips for transcript ${transcriptId}`);

      return this.mapJobToResult(job);
    } catch (error) {
      logger.error('Failed to extract clips:', error);
      throw error;
    }
  }

  private extractClipsFromTranscript(
    viralMoments: ViralMoment[] | null,
    options: {
      count?: number;
      minDuration?: number;
      maxDuration?: number;
    }
  ): GeneratedClip[] {
    if (!viralMoments || viralMoments.length === 0) {
      return [];
    }

    const count = options.count || 3;
    const minDuration = (options.minDuration || 15) * 1000; // Convert to ms
    const maxDuration = (options.maxDuration || 60) * 1000;

    // Filter by duration and take top N
    return viralMoments
      .filter((moment) => {
        const duration = moment.end - moment.start;
        return duration >= minDuration && duration <= maxDuration;
      })
      .slice(0, count)
      .map((moment, index): GeneratedClip => ({
        id: `clip_${index + 1}`,
        title: moment.title,
        description: moment.description,
        startTime: moment.start,
        endTime: moment.end,
        duration: moment.end - moment.start,
        score: moment.score,
        keywords: moment.keywords,
      }));
  }

  /**
   * Create a video composition
   */
  async createComposition(
    composition: VideoComposition,
    tenantId: string,
    userId: string
  ): Promise<VideoJobResult> {
    try {
      const metadata: CompositionMetadata = { composition };

      // Create job record
      const job = await db.videoJob.create({
        data: {
          tenantId,
          type: 'render',
          status: 'pending',
          inputUrl: '',
          createdBy: userId,
          metadata: toInputJson(metadata),
        },
      });

      logger.info(`Created composition job ${job.id}`);

      return this.mapJobToResult(job);
    } catch (error) {
      logger.error('Failed to create composition:', error);
      throw error;
    }
  }

  /**
   * Render a video from composition
   */
  async renderVideo(
    compositionId: string,
    tenantId: string,
    userId: string
  ): Promise<VideoJobResult> {
    try {
      const compositionJob = await db.videoJob.findUnique({
        where: { id: compositionId },
      });

      if (!compositionJob || compositionJob.tenantId !== tenantId) {
        throw new Error('Composition not found');
      }

      const composition = extractComposition(compositionJob.metadata);
      if (!composition) {
        throw new Error('Composition metadata missing');
      }

      // Create render job
      const job = await db.videoJob.create({
        data: {
          tenantId,
          type: 'render',
          status: 'pending',
          inputUrl: '',
          compositionId,
          createdBy: userId,
        },
      });

      logger.info(`Created render job ${job.id}`);

      // Start rendering (async)
      this.processRender(job.id, composition).catch((err) => {
        logger.error(`Render job ${job.id} failed:`, err);
      });

      return this.mapJobToResult(job);
    } catch (error) {
      logger.error('Failed to start render:', error);
      throw error;
    }
  }

  /**
   * Background processing for video rendering
   */
  private async processRender(
    jobId: string,
    composition: VideoComposition
  ): Promise<void> {
    try {
      // Update to processing
      await db.videoJob.update({
        where: { id: jobId },
        data: { status: 'processing', progress: 10 },
      });

      // Start render
      const { renderId } = await this.shotstack.renderVideo(composition);

      await db.videoJob.update({
        where: { id: jobId },
        data: { renderId, progress: 30 },
      });

      // Poll for completion
      const videoUrl = await this.shotstack.waitForRender(renderId);

      // Mark as completed
      await db.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          progress: 100,
          outputUrls: [videoUrl],
          completedAt: new Date(),
        },
      });

      logger.info(`Render job ${jobId} completed: ${videoUrl}`);
    } catch (error: unknown) {
      logger.error(`Render job ${jobId} failed:`, error);

      await db.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: getErrorMessage(error),
        },
      });
    }
  }

  /**
   * Add captions to a video
   */
  async addCaptions(
    videoUrl: string,
    transcriptId: string,
    tenantId: string,
    userId: string,
    style?: CaptionStyleOptions
  ): Promise<VideoJobResult> {
    try {
      const transcript = await db.videoTranscript.findUnique({
        where: { id: transcriptId },
      });

      if (!transcript || transcript.tenantId !== tenantId) {
        throw new Error('Transcript not found');
      }

      // Create job
      const job = await db.videoJob.create({
        data: {
          tenantId,
          type: 'add_captions',
          status: 'pending',
          inputUrl: videoUrl,
          transcriptId,
          createdBy: userId,
        },
      });

      // Start captioning (async)
      this.processCaptions(job.id, videoUrl, transcript, style).catch((err) => {
        logger.error(`Caption job ${job.id} failed:`, err);
      });

      return this.mapJobToResult(job);
    } catch (error) {
      logger.error('Failed to add captions:', error);
      throw error;
    }
  }

  private async processCaptions(
    jobId: string,
    videoUrl: string,
    transcript: VideoTranscript,
    style?: CaptionStyleOptions
  ): Promise<void> {
    try {
      await db.videoJob.update({
        where: { id: jobId },
        data: { status: 'processing', progress: 20 },
      });

      // Convert words to caption format
      const words = parseCaptionWords(transcript.words);
      const captions = this.groupWordsIntoCaptions(words);

      // Render with captions
      const { renderId } = await this.shotstack.createCaptionedVideo(
        videoUrl,
        captions,
        style
      );

      await db.videoJob.update({
        where: { id: jobId },
        data: { renderId, progress: 50 },
      });

      const outputUrl = await this.shotstack.waitForRender(renderId);

      await db.videoJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          progress: 100,
          outputUrls: [outputUrl],
          completedAt: new Date(),
        },
      });

      logger.info(`Caption job ${jobId} completed`);
    } catch (error: unknown) {
      logger.error(`Caption job ${jobId} failed:`, error);

      await db.videoJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: getErrorMessage(error) },
      });
    }
  }

  private groupWordsIntoCaptions(
    words: CaptionWord[]
  ): CaptionWord[] {
    const captions: CaptionWord[] = [];
    const wordsPerCaption = 3;

    for (let i = 0; i < words.length; i += wordsPerCaption) {
      const group = words.slice(i, i + wordsPerCaption);
      if (group.length === 0) {
        continue;
      }
      captions.push({
        text: group.map((w) => w.text).join(' '),
        start: group[0]!.start,
        end: group[group.length - 1]!.end,
      });
    }

    return captions;
  }

  /**
   * Optimize video for a specific platform
   */
  async optimizeForPlatform(
    videoUrl: string,
    platform: PlatformType,
    tenantId: string,
    userId: string
  ): Promise<VideoJobResult> {
    try {
      const platformSpec = PLATFORM_SPECS[platform];

      // Create job
      const job = await db.videoJob.create({
        data: {
          tenantId,
          type: 'optimize',
          status: 'pending',
          inputUrl: videoUrl,
          createdBy: userId,
          metadata: toInputJson({
            platform,
            platformSpec,
          }),
        },
      });

      // For now, just mark as completed
      // In production, this would call FFmpeg or Shotstack to re-encode
      await db.videoJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          progress: 100,
          outputUrls: [videoUrl], // Would be optimized URL
          completedAt: new Date(),
        },
      });

      logger.info(`Optimization job ${job.id} completed for platform ${platform}`);

      const refreshedJob = await db.videoJob.findUnique({ where: { id: job.id } });
      if (!refreshedJob) {
        throw new Error('Optimized job record missing');
      }

      return this.mapJobToResult(refreshedJob);
    } catch (error) {
      logger.error('Failed to optimize video:', error);
      throw error;
    }
  }

  /**
   * Get job status
   */
  async getJob(jobId: string, tenantId: string): Promise<VideoJobResult | null> {
    const job = await db.videoJob.findUnique({
      where: { id: jobId },
    });

    if (!job || job.tenantId !== tenantId) {
      return null;
    }

    return this.mapJobToResult(job);
  }

  /**
   * List jobs for a tenant
   */
  async listJobs(
    tenantId: string,
    options: {
      type?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ jobs: VideoJobResult[]; total: number }> {
    const where: Prisma.VideoJobWhereInput = { tenantId };

    if (options.type) {
      where.type = options.type;
    }

    if (options.status) {
      where.status = options.status;
    }

    const take = options.limit ?? 50;
    const skip = options.offset ?? 0;

    const [jobs, total] = await Promise.all([
      db.videoJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      db.videoJob.count({ where }),
    ]);

    return {
      jobs: jobs.map((job) => this.mapJobToResult(job)),
      total,
    };
  }

  /**
   * Delete/cancel a job
   */
  async deleteJob(jobId: string, tenantId: string): Promise<void> {
    const job = await db.videoJob.findUnique({
      where: { id: jobId },
    });

    if (!job || job.tenantId !== tenantId) {
      throw new Error('Job not found');
    }

    // If still processing, we'd cancel the external job here
    // For now, just delete from DB
    await db.videoJob.delete({
      where: { id: jobId },
    });

    logger.info(`Deleted job ${jobId}`);
  }

  private mapJobToResult(job: VideoJob): VideoJobResult {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      outputUrls: parseOutputUrls(job.outputUrls),
      transcriptId: job.transcriptId ?? undefined,
      error: job.error ?? undefined,
    };
  }
}

// Singleton instance
export const videoProductionService = new VideoProductionService();
