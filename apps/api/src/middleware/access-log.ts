import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '@ocsuite/db';
import { apiLogger } from '../utils/logger.js';

const SENSITIVE_PREFIXES = [
  '/actions',
  '/alerts',
  '/billing',
  '/board',
  '/connectors',
  '/knowledge',
  '/marketplace',
  '/modules',
  '/notifications',
  '/tasks',
  '/video',
];

const SENSITIVE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function shouldLog(req: Request): boolean {
  const { method } = req;
  const path = req.path || req.originalUrl || '';

  if (method === 'OPTIONS' || path === '/health' || path === '/' || path.startsWith('/metrics')) {
    return false;
  }

  if (SENSITIVE_METHODS.has(method)) {
    return true;
  }

  return SENSITIVE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

type JsonValue = Prisma.JsonValue;

function toJsonValue(value: unknown): JsonValue | null {
  try {
    if (value === undefined || value === null) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return null;
  }
}

function summarizeBody(body: unknown): JsonValue | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  if (Array.isArray(body)) {
    return { type: 'array', length: body.length };
  }

  const entries = Object.keys(body as Record<string, unknown>);
  return {
    keys: entries.slice(0, 20),
    truncated: entries.length > 20,
  };
}

export function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!shouldLog(req)) {
    next();
    return;
  }

  const startedAt = Date.now();

  res.on('finish', () => {
    const tenantId = req.tenantId ?? null;
    const userId = req.clerkId ?? req.auth?.userId ?? null;
    const durationMs = Date.now() - startedAt;

    const metadata: Prisma.JsonObject = {
      query: toJsonValue(req.query),
      body: summarizeBody(req.body),
      requestId: req.get('x-request-id') ?? null,
    };

    void prisma.accessLog
      .create({
        data: {
          tenantId,
          userId,
          method: req.method,
          route: req.originalUrl || req.path,
          statusCode: res.statusCode,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          durationMs,
          metadata,
        },
      })
      .catch((error) => {
        apiLogger.warn({ error, route: req.originalUrl || req.path }, 'Failed to record access log');
      });
  });

  next();
}
