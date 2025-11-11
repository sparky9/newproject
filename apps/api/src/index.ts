import { createApp } from './app.js';
import { config } from './config/index.js';
import { apiLogger } from './utils/logger.js';
import { initializeQueues, closeQueues } from './queue/index.js';
import { checkDatabaseHealth, disconnectDatabase } from '@ocsuite/db';
import { initializeCrypto } from '@ocsuite/crypto';
import { initializeTelemetry, shutdownTelemetry, parseOtlpHeaders } from './observability/telemetry.js';

/**
 * Initialize services and start the API server
 */
async function startServer() {
  try {
    apiLogger.info('Starting OC-Suite API server...', {
      environment: config.nodeEnv,
      port: config.port,
    });

    await initializeTelemetry({
      enabled: config.observability.enabled,
      serviceName: config.observability.serviceName,
      environment: config.nodeEnv,
      otlpEndpoint: config.observability.otlpEndpoint ?? undefined,
      otlpHeaders: parseOtlpHeaders(config.observability.otlpHeaders),
      metricIntervalMillis: config.observability.metricIntervalMillis,
      logLevel: config.observability.logLevel,
    });

    // Initialize crypto package with master key
    apiLogger.info('Initializing crypto package...');
    initializeCrypto({
      currentKey: config.masterEncryptionKey,
      currentKeyVersion: config.masterEncryptionKeyVersion,
      previousKeys: Object.keys(config.masterEncryptionPreviousKeys ?? {}).length
        ? config.masterEncryptionPreviousKeys
        : undefined,
    });
    apiLogger.info('Crypto package initialized');

    // Check database connectivity
    apiLogger.info('Checking database connectivity...');
    const dbHealthy = await checkDatabaseHealth();
    if (!dbHealthy) {
      throw new Error('Database health check failed');
    }
    apiLogger.info('Database connection healthy');

    // Initialize queues
    apiLogger.info('Initializing job queues...');
    await initializeQueues();
    apiLogger.info('Job queues initialized');

    // Create Express app
    const app = createApp();

    // Start HTTP server
    const server = app.listen(config.port, () => {
      apiLogger.info(`Server listening on port ${config.port}`, {
        environment: config.nodeEnv,
        port: config.port,
        nodeVersion: process.version,
      });

      console.log(`
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   🚀 OC-Suite API Server is running!                       │
│                                                             │
│   Environment:  ${config.nodeEnv.padEnd(44)}│
│   Port:         ${config.port.toString().padEnd(44)}│
│   URL:          http://localhost:${config.port.toString().padEnd(31)}│
│                                                             │
│   Endpoints:                                                │
│   - POST /c-suite/ceo/chat                                  │
│   - POST /c-suite/board-meeting                             │
│   - GET  /connectors                                        │
│   - POST /connectors/:provider/authorize                    │
│   - GET  /connectors/:provider/callback                     │
│   - POST /tasks/execute                                     │
│   - GET  /tasks/:taskId                                     │
│                                                             │
│   Health:       http://localhost:${config.port}/health${' '.repeat(19)}│
│                                                             │
└─────────────────────────────────────────────────────────────┘
      `);
    });

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      apiLogger.info(`${signal} received, starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(async () => {
        apiLogger.info('HTTP server closed');

        try {
          // Close queues
          apiLogger.info('Closing job queues...');
          await closeQueues();
          apiLogger.info('Job queues closed');

          // Disconnect database
          apiLogger.info('Disconnecting database...');
          await disconnectDatabase();
          apiLogger.info('Database disconnected');

          apiLogger.info('Shutting down telemetry...');
          await shutdownTelemetry();
          apiLogger.info('Telemetry shutdown complete');

          apiLogger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          apiLogger.error('Error during graceful shutdown', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        apiLogger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Handle termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error: Error) => {
      apiLogger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack,
      });
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason: unknown) => {
      apiLogger.error('Unhandled promise rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      gracefulShutdown('unhandledRejection');
    });

  } catch (error) {
    apiLogger.error('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    await shutdownTelemetry().catch(() => {
      /* noop */
    });
    process.exit(1);
  }
}

// Start the server
startServer();
