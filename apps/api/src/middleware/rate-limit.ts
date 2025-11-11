import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import { Request } from 'express';
import { getRedisConnection } from '../queue/index.js';
import { apiLogger } from '../utils/logger.js';

type RedisCommandArg = string | number;
type RedisCallArgs = [command: string, ...args: RedisCommandArg[]];

function createRedisRateLimitStore(prefix: string): RedisStore {
  return new RedisStore({
    sendCommand: async (...args: RedisCallArgs): Promise<RedisReply> => {
      const [command, ...commandArgs] = args;
      const redis = getRedisConnection();
      const result = await redis.call(command, ...commandArgs);
      return result as RedisReply;
    },
    prefix,
  });
}

/**
 * Rate limiter for chat endpoints
 *
 * Limits requests per tenant to prevent abuse and control costs
 * - 10 requests per minute per tenant
 * - Uses Redis for distributed rate limiting across instances
 */
export const chatRateLimiter = rateLimit({
  store: createRedisRateLimitStore('rate_limit:chat:'),
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per tenant
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers

  // Use tenant ID as the key for rate limiting
  keyGenerator: (req: Request) => {
    // Rate limit by tenant if available, otherwise by IP
    return req.tenantId || req.ip || 'unknown';
  },

  // Custom handler for rate limit exceeded
  handler: (req, res) => {
    apiLogger.warn('Rate limit exceeded', {
      tenantId: req.tenantId,
      ip: req.ip,
      path: req.path,
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: 'You have exceeded the rate limit. Please wait a moment before sending another message.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 60, // seconds
    });
  },

  // Skip rate limiting in certain conditions
  skip: (req) => {
    // Skip rate limiting for health checks
    if (req.path === '/health') {
      return true;
    }
    return false;
  },
});

/**
 * General API rate limiter
 *
 * Broader rate limit for all API endpoints
 * - 100 requests per 15 minutes per tenant
 */
export const apiRateLimiter = rateLimit({
  store: createRedisRateLimitStore('rate_limit:api:'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes per tenant
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) => {
    return req.tenantId || req.ip || 'unknown';
  },

  handler: (req, res) => {
    apiLogger.warn('API rate limit exceeded', {
      tenantId: req.tenantId,
      ip: req.ip,
      path: req.path,
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: 'API rate limit exceeded. Please try again later.',
      code: 'API_RATE_LIMIT_EXCEEDED',
      retryAfter: 900, // 15 minutes in seconds
    });
  },

  skip: (req) => {
    // Skip for health checks
    if (req.path === '/health' || req.path === '/api/health') {
      return true;
    }
    return false;
  },
});

/**
 * Strict rate limiter for expensive operations
 *
 * Very conservative rate limit for operations like bulk imports
 * - 5 requests per hour per tenant
 */
export const strictRateLimiter = rateLimit({
  store: createRedisRateLimitStore('rate_limit:strict:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) => {
    return req.tenantId || req.ip || 'unknown';
  },

  handler: (req, res) => {
    apiLogger.warn('Strict rate limit exceeded', {
      tenantId: req.tenantId,
      ip: req.ip,
      path: req.path,
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: 'This operation has a strict rate limit. Please try again later.',
      code: 'STRICT_RATE_LIMIT_EXCEEDED',
      retryAfter: 3600, // 1 hour in seconds
    });
  },
});
