import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration schema with validation
const configSchema = z.object({
  // Server
  port: z.coerce.number().default(3001),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  databaseUrl: z.string().url(),

  // Redis
  redisUrl: z.string().url(),
  redisMaxRetries: z.coerce.number().default(3),

  // Queue Configuration
  queueSyncConnectorConcurrency: z.coerce.number().default(5),
  queueExecuteTaskConcurrency: z.coerce.number().default(10),
  queueActionExecutorConcurrency: z.coerce.number().default(5),
  queueBoardMeetingConcurrency: z.coerce.number().default(2),
  queueTriggerRunnerConcurrency: z.coerce.number().default(3),
  queueMaxRetries: z.coerce.number().default(3),
  queueBackoffDelay: z.coerce.number().default(5000),
  queueRemoveOnComplete: z.coerce.number().default(100),
  queueRemoveOnFail: z.coerce.number().default(1000),
  triggerRunnerCron: z.string().default('*/10 * * * *'),

  // Clerk Authentication
  clerkSecretKey: z.string().min(1),
  clerkPublishableKey: z.string().min(1),

  // Encryption
  masterEncryptionKey: z.string().min(1),
  masterEncryptionKeyVersion: z.coerce.number().int().positive().default(1),
  masterEncryptionPreviousKeys: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) {
        return {} as Record<number, string>;
      }

      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const entries = Object.entries(parsed);
        const result: Record<number, string> = {};

        for (const [rawVersion, keyValue] of entries) {
          const version = Number(rawVersion);

          if (!Number.isInteger(version) || version <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Invalid key version "${rawVersion}" in MASTER_ENCRYPTION_PREVIOUS_KEYS`,
            });
            return z.NEVER;
          }

          if (typeof keyValue !== 'string' || !keyValue.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Missing key for version "${rawVersion}" in MASTER_ENCRYPTION_PREVIOUS_KEYS`,
            });
            return z.NEVER;
          }

          result[version] = keyValue.trim();
        }

        return result;
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MASTER_ENCRYPTION_PREVIOUS_KEYS must be valid JSON (e.g., {"1":"oldKey"})',
        });
        return z.NEVER;
      }
    }),

  // Logging
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Rate Limiting
  rateLimitWindowMs: z.coerce.number().default(900000), // 15 minutes
  rateLimitMaxRequests: z.coerce.number().default(100),

  // CORS
  corsOrigin: z.string().default('http://localhost:3000'),

  // Internal admin API access
  internalAdminApiKey: z.string().optional(),

  // OAuth Providers
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),
  googleRedirectUri: z.string().optional(),

  // Fireworks AI Configuration
  fireworks: z.object({
    apiKey: z.string().min(1),
    model: z.string().default('accounts/fireworks/models/qwen2p5-72b-instruct'),
    maxTokens: z.coerce.number().default(2048),
    temperature: z.coerce.number().default(0.7),
    embeddingModel: z.string().default('accounts/fireworks/models/text-embedding-004'),
    embeddingDimensions: z.coerce.number().default(1536),
  }),

  // PostHog / telemetry configuration
  posthog: z
    .object({
      apiKey: z.string().optional(),
      host: z.string().url().optional(),
    })
    .default({})
    .transform((value) => ({
      apiKey: value.apiKey?.trim() || null,
      host: value.host?.trim() || 'https://app.posthog.com',
    })),

  telemetry: z
    .object({
      disabledTenants: z.string().optional(),
    })
    .default({})
    .transform((value) => ({
      disabledTenants: value.disabledTenants
        ? value.disabledTenants
            .split(',')
            .map((tenant) => tenant.trim())
            .filter((tenant) => tenant.length > 0)
        : [],
    })),

  observability: z
    .object({
      enabled: z.coerce.boolean().optional(),
      serviceName: z.string().optional(),
      otlpEndpoint: z.string().url().optional(),
      otlpHeaders: z.string().optional(),
      metricIntervalMillis: z.coerce.number().optional(),
      logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    })
    .default({})
    .transform((value) => ({
      enabled: value.enabled ?? false,
      serviceName: value.serviceName?.trim() || 'ocsuite-api',
      otlpEndpoint: value.otlpEndpoint?.trim() || null,
      otlpHeaders: value.otlpHeaders?.trim() || null,
      metricIntervalMillis: value.metricIntervalMillis ?? 15000,
      logLevel: value.logLevel ?? 'warn',
    })),

  stripe: z
    .object({
      webhookSecret: z.string().optional(),
    })
    .default({})
    .transform((value) => ({
      webhookSecret: value.webhookSecret?.trim() || null,
    })),

  // Video Production API Keys
  assemblyAIApiKey: z.string().optional(),
  shotstackApiKey: z.string().optional(),
  pexelsApiKey: z.string().optional(),
  unsplashApiKey: z.string().optional(),
  freesoundApiKey: z.string().optional(),
  runwayApiKey: z.string().optional(),
  elevenLabsApiKey: z.string().optional(),
});

// Parse and validate configuration
const rawConfig = {
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  redisMaxRetries: process.env.REDIS_MAX_RETRIES,
  queueSyncConnectorConcurrency: process.env.QUEUE_SYNC_CONNECTOR_CONCURRENCY,
  queueExecuteTaskConcurrency: process.env.QUEUE_EXECUTE_TASK_CONCURRENCY,
  queueActionExecutorConcurrency: process.env.QUEUE_ACTION_EXECUTOR_CONCURRENCY,
  queueBoardMeetingConcurrency: process.env.QUEUE_BOARD_MEETING_CONCURRENCY,
  queueTriggerRunnerConcurrency: process.env.QUEUE_TRIGGER_RUNNER_CONCURRENCY,
  queueMaxRetries: process.env.QUEUE_MAX_RETRIES,
  queueBackoffDelay: process.env.QUEUE_BACKOFF_DELAY,
  queueRemoveOnComplete: process.env.QUEUE_REMOVE_ON_COMPLETE,
  queueRemoveOnFail: process.env.QUEUE_REMOVE_ON_FAIL,
  triggerRunnerCron: process.env.TRIGGER_RUNNER_CRON,
  clerkSecretKey: process.env.CLERK_SECRET_KEY,
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  masterEncryptionKey: process.env.MASTER_ENCRYPTION_KEY,
  masterEncryptionKeyVersion: process.env.MASTER_ENCRYPTION_KEY_VERSION,
  masterEncryptionPreviousKeys: process.env.MASTER_ENCRYPTION_PREVIOUS_KEYS,
  logLevel: process.env.LOG_LEVEL,
  rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: process.env.RATE_LIMIT_MAX_REQUESTS,
  corsOrigin: process.env.CORS_ORIGIN,
  internalAdminApiKey: process.env.INTERNAL_ADMIN_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
  fireworks: {
    apiKey: process.env.FIREWORKS_API_KEY,
    model: process.env.FIREWORKS_MODEL,
    maxTokens: process.env.FIREWORKS_MAX_TOKENS,
    temperature: process.env.FIREWORKS_TEMPERATURE,
    embeddingModel: process.env.FIREWORKS_EMBEDDING_MODEL,
    embeddingDimensions: process.env.FIREWORKS_EMBEDDING_DIMENSIONS,
  },
  posthog: {
    apiKey: process.env.POSTHOG_API_KEY,
    host: process.env.POSTHOG_HOST,
  },
  telemetry: {
    disabledTenants: process.env.TELEMETRY_DISABLED_TENANTS,
  },
  observability: {
    enabled: process.env.OBSERVABILITY_ENABLED,
    serviceName: process.env.OBSERVABILITY_SERVICE_NAME,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpHeaders: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    metricIntervalMillis: process.env.OBSERVABILITY_METRIC_INTERVAL_MS,
    logLevel: process.env.OTEL_LOG_LEVEL ?? process.env.OBSERVABILITY_LOG_LEVEL,
  },
  stripe: {
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  assemblyAIApiKey: process.env.ASSEMBLYAI_API_KEY,
  shotstackApiKey: process.env.SHOTSTACK_API_KEY,
  pexelsApiKey: process.env.PEXELS_API_KEY,
  unsplashApiKey: process.env.UNSPLASH_API_KEY,
  freesoundApiKey: process.env.FREESOUND_API_KEY,
  runwayApiKey: process.env.RUNWAY_API_KEY,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
};

const parseResult = configSchema.safeParse(rawConfig);

if (!parseResult.success) {
  console.error('Configuration validation failed:');
  console.error(parseResult.error.format());
  process.exit(1);
}

export const config = parseResult.data;

export type Config = z.infer<typeof configSchema>;
