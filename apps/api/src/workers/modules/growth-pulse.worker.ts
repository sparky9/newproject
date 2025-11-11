import { Worker, Job, Queue } from 'bullmq';
import { getRedisConnection, alertsQueue } from '../../queue/index.js';
import { createTenantClient } from '@ocsuite/db';
import { workerLogger } from '../../utils/logger.js';
import { instrumentWorker } from '../../observability/worker-metrics.js';
import { streamCompletion } from '../../services/llm/fireworks-client.js';
import { toInputJson } from '../../utils/json.js';
import {
  calculateMetrics,
  calculateDefaultScore,
  determineSeverity,
  generateDefaultActions,
  generateDefaultHighlights,
  generateDefaultSummary,
  type GrowthMetrics,
  type InsightActionItem,
  type GrowthPulseInsight,
} from '../../modules/growth-pulse/common.js';

interface GrowthPulseJobData {
  tenantId: string;
  triggeredBy: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

// Create queue
export const growthPulseQueue = new Queue('growth-pulse', {
  connection: getRedisConnection(),
});

// Worker implementation
export const createGrowthPulseWorker = (): Worker => {
  return instrumentWorker(
    new Worker<GrowthPulseJobData>(
    'growth-pulse',
    async (job: Job<GrowthPulseJobData>) => {
      const { tenantId, triggeredBy, dateRange } = job.data;

      workerLogger.info('Starting Growth Pulse analysis', {
        jobId: job.id,
        tenantId,
      });

      await job.updateProgress(20);

      // Step 1: Fetch analytics data
      const prisma = createTenantClient({ tenantId, userId: triggeredBy });

      try {
        const endDate = dateRange?.end ? new Date(dateRange.end) : new Date();
        const startDate = dateRange?.start
          ? new Date(dateRange.start)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

        const snapshots = await prisma.analyticsSnapshot.findMany({
          where: {
            tenantId,
            date: {
              gte: startDate,
              lte: endDate,
            },
          },
          orderBy: { date: 'asc' },
        });

        if (snapshots.length === 0) {
          workerLogger.warn('No analytics data found for Growth Pulse', {
            tenantId
          });
          throw new Error('Insufficient data for analysis');
        }

        await job.updateProgress(40);

        // Step 2: Calculate aggregated metrics
  const metrics = calculateMetrics(snapshots);

        await job.updateProgress(60);

        // Step 3: Get LLM commentary
  const insight = await generateInsightWithLLM(tenantId, triggeredBy, metrics);

        await job.updateProgress(80);

        // Step 4: Save ModuleInsight
        const moduleInsight = await prisma.moduleInsight.create({
          data: {
            tenantId,
            moduleSlug: 'growth-pulse',
            severity: insight.severity,
            summary: insight.summary,
            highlights: insight.highlights,
            score: insight.score,
            actionItems: toInputJson(insight.actionItems),
            metadata: toInputJson({
              metrics,
              dataPoints: snapshots.length,
              dateRange: {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
              },
            }),
          },
        });

        // Step 5: Publish alert for high severity insights
        if (insight.severity === 'critical' || (insight.severity === 'warning' && insight.score < 50)) {
          await alertsQueue.add('module-alert', {
            tenantId,
            type: 'module-insight',
            severity: insight.severity,
            moduleSlug: 'growth-pulse',
            insightId: moduleInsight.id,
            summary: insight.summary,
            metadata: {
              score: insight.score,
              createdAt: moduleInsight.createdAt.toISOString(),
            },
          });

          workerLogger.info({ insightId: moduleInsight.id, severity: insight.severity }, 'Alert enqueued');
        }

        await job.updateProgress(100);

        workerLogger.info('Growth Pulse complete', {
          jobId: job.id,
          tenantId,
          insightId: moduleInsight.id,
        });

        return {
          insightId: moduleInsight.id,
          severity: insight.severity,
          score: insight.score,
        };
      } finally {
        await prisma.$disconnect();
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    }
    )
  );
};

// Generate insights using LLM
async function generateInsightWithLLM(
  tenantId: string,
  userId: string,
  metrics: GrowthMetrics
): Promise<GrowthPulseInsight> {
  const prompt = buildAnalysisPrompt(metrics);
  let fullResponse = '';

  for await (const chunk of streamCompletion({
    messages: [
      {
        role: 'system',
        content: 'You are a growth analyst providing concise, actionable insights. Always respond with valid JSON only, no additional text.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    tenantId,
    userId,
    maxTokens: 1024,
  })) {
    if (!chunk.done) {
      fullResponse += chunk.content;
    }
  }

  // Parse LLM response into structured format
  return parseInsightResponse(fullResponse, metrics);
}

function buildAnalysisPrompt(metrics: GrowthMetrics): string {
  return `Analyze this business's growth metrics and provide insights:

Metrics:
- Total Revenue: $${metrics.totalRevenue.toFixed(2)}
- Growth Rate: ${metrics.growthRate.toFixed(1)}%
- Conversion Rate: ${metrics.conversionRate.toFixed(2)}%
- Avg Revenue per User: $${metrics.avgRevenuePerUser.toFixed(2)}
- Total Users: ${metrics.totalUsers}
- Total Sessions: ${metrics.totalSessions}
- Data Points: ${metrics.dataPoints} days

Provide your analysis in the following JSON format:
{
  "score": <number 0-100>,
  "severity": "<info|warning|critical>",
  "summary": "<2-3 sentence summary>",
  "highlights": ["<highlight 1>", "<highlight 2>", "<highlight 3>"],
  "actionItems": [
    {
      "title": "<action title>",
      "description": "<action description>",
      "priority": "<low|medium|high>",
      "estimatedImpact": "<impact description>"
    }
  ]
}

Respond with ONLY the JSON, no additional text.`;
}

function parseInsightResponse(response: string, metrics: GrowthMetrics): GrowthPulseInsight {
  try {
    // Clean up response - remove markdown code blocks if present
    let cleanedResponse = response.trim();
    if (cleanedResponse.startsWith('```json')) {
      cleanedResponse = cleanedResponse.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    // Try to parse as JSON first
    const parsed = JSON.parse(cleanedResponse);
    const severity =
      typeof parsed.severity === 'string' &&
      ['info', 'warning', 'critical'].includes(parsed.severity)
        ? (parsed.severity as 'info' | 'warning' | 'critical')
        : determineSeverity(metrics);

    const highlightsSource = Array.isArray(parsed.highlights)
      ? (parsed.highlights as unknown[])
      : [];

    const highlights = highlightsSource
      .map((value) => String(value ?? ''))
      .filter((value) => value.length > 0);

    const actionItemsSource = Array.isArray(parsed.actionItems)
      ? (parsed.actionItems as unknown[])
      : [];

    const actionItems = actionItemsSource
      .filter((item): item is InsightActionItem => typeof item === 'object' && item !== null)
      .map((item) => ({
        title: String(item.title ?? ''),
        description: item.description ? String(item.description) : undefined,
        priority: item.priority ? String(item.priority) : undefined,
        estimatedImpact: item.estimatedImpact ? String(item.estimatedImpact) : undefined,
      }));

    return {
  score: typeof parsed.score === 'number' ? parsed.score : calculateDefaultScore(metrics),
  severity,
  summary: typeof parsed.summary === 'string' ? parsed.summary : generateDefaultSummary(metrics),
      highlights,
      actionItems,
    };
  } catch (error) {
    workerLogger.warn('Failed to parse LLM response as JSON, using fallback', {
      error: error instanceof Error ? error.message : 'Unknown error',
      response: response.substring(0, 200),
    });

    // Fallback to heuristic generation
    return {
      score: calculateDefaultScore(metrics),
      severity: determineSeverity(metrics),
      summary: generateDefaultSummary(metrics),
      highlights: generateDefaultHighlights(metrics),
      actionItems: generateDefaultActions(metrics),
    };
  }
}

// Event listeners
let worker: Worker | null = null;

export const startGrowthPulseWorker = (): Worker => {
  if (worker) {
    return worker;
  }

  worker = createGrowthPulseWorker();

  worker.on('completed', (job) => {
    workerLogger.info('Growth Pulse job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    workerLogger.error('Growth Pulse job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
};
