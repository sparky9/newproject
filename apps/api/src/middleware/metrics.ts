import { Request, Response, NextFunction } from 'express';
import { incrementHttpRequest } from '../utils/metrics.js';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    const routePattern = typeof req.route?.path === 'string'
      ? `${req.baseUrl ?? ''}${req.route.path}`
      : req.baseUrl
        ? `${req.baseUrl}${req.path}`
        : req.path;

    incrementHttpRequest(req.method, routePattern, res.statusCode, duration);

    // Log slow requests (> 2 seconds)
    if (duration > 2000) {
      req.log?.warn({ method: req.method, path: req.path, duration }, 'Slow request detected');
    }
  });

  next();
}
