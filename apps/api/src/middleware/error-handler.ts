import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { TenantContextError } from '@ocsuite/db';
import { AuthenticationError, InvalidCiphertextError } from '@ocsuite/crypto';
import { apiLogger } from '../utils/logger.js';

/**
 * Standard error response format
 */
interface ErrorResponse {
  error: string;
  message: string;
  code: string;
  details?: unknown;
  stack?: string;
}

/**
 * Error handler middleware
 *
 * Catches all errors thrown in route handlers and converts them to
 * standardized JSON error responses with appropriate HTTP status codes
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Log the error
  apiLogger.error('Error caught by error handler', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    tenantId: req.tenantId,
    userId: req.clerkId,
    name: err.name,
  });

  // Default error response
  let statusCode = 500;
  let errorResponse: ErrorResponse = {
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    code: 'INTERNAL_SERVER_ERROR',
  };

  // Handle specific error types
  if (err instanceof ZodError) {
    // Validation errors
    statusCode = 400;
    errorResponse = {
      error: 'Validation Error',
      message: 'Request validation failed',
      code: 'VALIDATION_ERROR',
      details: err.format(),
    };
  } else if (err instanceof TenantContextError) {
    // Tenant context errors
    statusCode = 500;
    errorResponse = {
      error: 'Internal Server Error',
      message: 'Tenant context error',
      code: 'TENANT_CONTEXT_ERROR',
    };
  } else if (err instanceof AuthenticationError || err instanceof InvalidCiphertextError) {
    // Crypto errors - usually means data corruption or wrong keys
    statusCode = 500;
    errorResponse = {
      error: 'Internal Server Error',
      message: 'Failed to process encrypted data',
      code: 'CRYPTO_ERROR',
    };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Prisma known errors
    switch (err.code) {
      case 'P2002':
        // Unique constraint violation
        statusCode = 409;
        errorResponse = {
          error: 'Conflict',
          message: 'A record with this value already exists',
          code: 'DUPLICATE_RECORD',
          details: { target: err.meta?.target },
        };
        break;

      case 'P2025':
        // Record not found
        statusCode = 404;
        errorResponse = {
          error: 'Not Found',
          message: 'The requested record was not found',
          code: 'RECORD_NOT_FOUND',
        };
        break;

      case 'P2003':
        // Foreign key constraint violation
        statusCode = 400;
        errorResponse = {
          error: 'Bad Request',
          message: 'Invalid reference to related record',
          code: 'INVALID_REFERENCE',
          details: { field: err.meta?.field_name },
        };
        break;

      default:
        statusCode = 500;
        errorResponse = {
          error: 'Database Error',
          message: 'A database error occurred',
          code: 'DATABASE_ERROR',
          details: { code: err.code },
        };
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    // Prisma validation errors
    statusCode = 400;
    errorResponse = {
      error: 'Validation Error',
      message: 'Database validation failed',
      code: 'DATABASE_VALIDATION_ERROR',
    };
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    // Database connection errors
    statusCode = 503;
    errorResponse = {
      error: 'Service Unavailable',
      message: 'Database connection failed',
      code: 'DATABASE_CONNECTION_ERROR',
    };
  } else if (err.name === 'UnauthorizedError') {
    // JWT/auth errors
    statusCode = 401;
    errorResponse = {
      error: 'Unauthorized',
      message: err.message || 'Authentication required',
      code: 'UNAUTHORIZED',
    };
  } else if (err.name === 'ForbiddenError') {
    // Authorization errors
    statusCode = 403;
    errorResponse = {
      error: 'Forbidden',
      message: err.message || 'Access denied',
      code: 'FORBIDDEN',
    };
  } else if (err.name === 'NotFoundError') {
    // Not found errors
    statusCode = 404;
    errorResponse = {
      error: 'Not Found',
      message: err.message || 'Resource not found',
      code: 'NOT_FOUND',
    };
  } else if (err.name === 'BadRequestError') {
    // Bad request errors
    statusCode = 400;
    errorResponse = {
      error: 'Bad Request',
      message: err.message || 'Invalid request',
      code: 'BAD_REQUEST',
    };
  } else {
    // Generic errors
    errorResponse = {
      error: 'Internal Server Error',
      message: err.message || 'An unexpected error occurred',
      code: 'INTERNAL_SERVER_ERROR',
    };
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Not Found handler
 *
 * Catches all requests that don't match any routes
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  apiLogger.warn('Route not found', {
    path: req.path,
    method: req.method,
    tenantId: req.tenantId,
    userId: req.clerkId,
  });

  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    code: 'ROUTE_NOT_FOUND',
  });
};

/**
 * Async error wrapper
 *
 * Wraps async route handlers to catch errors and pass them to the error handler
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Custom error classes
 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
