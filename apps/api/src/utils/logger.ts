import pino from 'pino';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const logLevel = process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info');

// Create base Pino logger without requiring full config bootstrap
export const logger = pino({
  level: logLevel,
  transport: nodeEnv === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'ocsuite-api',
    env: nodeEnv,
  },
});

// Create child loggers for specific contexts
export const createContextLogger = (context: string, meta?: Record<string, unknown>) => {
  return logger.child({ context, ...meta });
};

// Queue-specific logger
export const queueLogger = createContextLogger('queue');

// Worker-specific logger
export const workerLogger = createContextLogger('worker');

// API-specific logger
export const apiLogger = createContextLogger('api');

// SSE-specific logger
export const sseLogger = createContextLogger('sse');
