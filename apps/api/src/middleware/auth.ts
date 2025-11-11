import { Request, Response, NextFunction } from 'express';
import { clerkClient } from '@clerk/express';
import { verifyToken as clerkVerifyToken } from '@clerk/backend';
import { config } from '../config/index.js';
import { apiLogger } from '../utils/logger.js';

/**
 * Validates Clerk JWT token and attaches auth context to request
 * This middleware validates the JWT but doesn't require authentication
 */
export const validateClerkJWT = () => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // No token provided, continue without auth
        return next();
      }

      const token = authHeader.substring(7);
      
      try {
        // Verify the token using Clerk
        const decoded = await clerkVerifyToken(token, {
          secretKey: config.clerkSecretKey,
        });
        
        // Attach auth information to request
        req.auth = {
          userId: decoded.sub,
          sessionId: decoded.sid || '',
          claims: decoded,
        };
        
        req.clerkId = decoded.sub;
        
        apiLogger.debug('JWT validated successfully', {
          userId: decoded.sub,
          sessionId: decoded.sid,
        });
        
        next();
      } catch (error) {
        apiLogger.warn('Invalid JWT token', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        
        // Invalid token, but don't fail - just don't attach auth
        next();
      }
    } catch (error) {
      apiLogger.error('Error in JWT validation middleware', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      next(error);
    }
  };
};

/**
 * Requires authentication - fails if user is not authenticated
 * Use this middleware on protected routes
 */
export const requireAuth = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !req.clerkId) {
      apiLogger.warn('Unauthorized access attempt', {
        path: req.path,
        method: req.method,
      });
      
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required. Please provide a valid Bearer token.',
        code: 'AUTH_REQUIRED',
      });
    }
    
    next();
  };
};

/**
 * Optional auth middleware - validates token if present but doesn't require it
 */
export const optionalAuth = validateClerkJWT;

/**
 * Get user from Clerk by ID
 */
export const getClerkUser = async (userId: string) => {
  try {
  const user = await clerkClient.users.getUser(userId);
    return user;
  } catch (error) {
    apiLogger.error('Failed to get Clerk user', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

export const verifyClerkToken = async (token: string) => {
  return clerkVerifyToken(token, {
    secretKey: config.clerkSecretKey,
  });
};
