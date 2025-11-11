import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { validateClerkJWT } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiLogger, logger } from './utils/logger.js';
import { config } from './config/index.js';

// Import route handlers
import chatRoutes from './routes/chat.routes.js';
import boardRoutes from './routes/board.routes.js';
import connectorsRoutes from './routes/connectors.routes.js';
import tasksRoutes from './routes/tasks.routes.js';
import modulesRoutes from './routes/modules.routes.js';
import boardManagementRoutes from './routes/board-management.routes.js';
import actionsRoutes from './routes/actions.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import alertsRoutes from './routes/alerts.routes.js';
import healthRoutes from './routes/health.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';
import videoRoutes from './routes/video.routes.js';
import marketplaceRoutes from './routes/marketplace.routes.js';
import billingRoutes from './routes/billing.routes.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { accessLogMiddleware } from './middleware/access-log.js';

/**
 * Create and configure Express application
 */
export function createApp(): Application {
  const app = express();

  // Trust proxy (important for accurate client IP when behind reverse proxy)
  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for API
    crossOriginEmbedderPolicy: false,
  }));

  // CORS configuration
  app.use(cors({
    origin: config.corsOrigin.split(',').map(o => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }));

  // Compression
  app.use(compression());

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Metrics middleware (track all requests)
  app.use(metricsMiddleware);

  // Request logging with Pino
  app.use(pinoHttp({
    logger,
    autoLogging: {
      ignore: (req: Request) => {
        // Don't log health check requests
        return req.url === '/health' || req.url === '/';
      },
    },
    customLogLevel: (_req: Request, res: Response, err?: Error) => {
      if (res.statusCode >= 400 && res.statusCode < 500) {
        return 'warn';
      } else if (res.statusCode >= 500 || err) {
        return 'error';
      }
      return 'info';
    },
    customSuccessMessage: (req: Request, res: Response) => {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    customErrorMessage: (req: Request, res: Response, err: Error) => {
      return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
    },
  }));

  // JWT validation middleware (validates token if present but doesn't require it)
  app.use(validateClerkJWT());

  // Access log middleware for sensitive endpoints
  app.use(accessLogMiddleware);

  // Mount health routes (publicly accessible, no auth required)
  app.use('/', healthRoutes);

  // Root endpoint (defined after health routes to avoid conflict)
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      name: 'OC-Suite API',
      version: '0.1.0',
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/health',
        healthDetailed: '/health/detailed',
        healthQueues: '/health/queues',
        metrics: '/metrics',
        chat: '/c-suite/ceo/chat',
        boardMeeting: '/c-suite/board-meeting',
        connectors: '/connectors',
        actions: '/actions',
        tasks: '/tasks',
        modules: '/modules',
        notifications: '/notifications',
        alerts: '/alerts',
        knowledgeSearch: '/knowledge/search',
        video: '/video',
        marketplace: '/marketplace/widgets',
        billingUsage: '/billing/usage',
        billingWebhook: '/billing/webhook',
      },
    });
  });

  // Mount route handlers
  apiLogger.info('Mounting route handlers...');

  // C-Suite routes
  app.use('/c-suite/ceo', chatRoutes);
  app.use('/c-suite', boardRoutes);
  app.use('/board', boardManagementRoutes);

  // Connector routes
  app.use('/connectors', connectorsRoutes);

  // Action approval routes
  app.use('/actions', actionsRoutes);

  // Task routes
  app.use('/tasks', tasksRoutes);

  // Module routes
  app.use('/modules', modulesRoutes);

  // Notification & alert routes
  app.use('/notifications', notificationsRoutes);
  app.use('/alerts', alertsRoutes);
  app.use('/knowledge', knowledgeRoutes);
  app.use('/marketplace', marketplaceRoutes);
  app.use('/billing', billingRoutes);

  // Video production routes
  app.use('/video', videoRoutes);

  apiLogger.info('All routes mounted successfully', {
    routes: [
      'POST /c-suite/ceo/chat',
      'GET /c-suite/ceo/conversations',
      'POST /c-suite/ceo/conversations',
      'GET /c-suite/ceo/conversations/:conversationId',
      'GET /c-suite/ceo/conversations/:conversationId/messages',
      'POST /c-suite/board-meeting',
    'GET /board/meetings',
    'GET /board/meetings/:id',
    'PATCH /board/action-items/:id',
      'GET /connectors',
      'POST /connectors/:provider/authorize',
      'GET /connectors/:provider/callback',
      'POST /tasks/execute',
      'GET /tasks/:taskId',
    'POST /actions/submit',
    'GET /actions/pending',
    'POST /actions/:id/approve',
    'POST /actions/:id/reject',
  'GET /notifications/stats',
    'GET /notifications',
    'POST /notifications/:id/read',
    'POST /notifications/read-all',
    'GET /alerts',
    'POST /alerts/:id/acknowledge',
    'POST /knowledge/search',
    'GET /marketplace/widgets',
    'POST /marketplace/widgets',
    'POST /marketplace/widgets/:slug/install',
    'DELETE /marketplace/widgets/:slug/install',
  'GET /billing/usage',
  'POST /billing/webhook',
      'GET /modules/growth-pulse/insights',
      'GET /modules/growth-pulse/insights/:insightId',
      'POST /modules/growth-pulse/run',
      'GET /modules/growth-pulse/job/:jobId',
      'POST /video/transcribe',
      'POST /video/extract-clips',
      'POST /video/render',
      'POST /video/add-captions',
      'POST /video/optimize',
      'GET /video/jobs',
      'GET /video/jobs/:id',
      'DELETE /video/jobs/:id',
    ],
  });

  // 404 handler (must be after all routes)
  app.use(notFoundHandler);

  // Error handling middleware (must be last)
  app.use(errorHandler);

  return app;
}
