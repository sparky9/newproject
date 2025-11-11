import { Router as createRouter } from 'express';
import type { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { createTenantClient } from '@ocsuite/db';
import { encryptForTenant, getCurrentKeyVersion } from '@ocsuite/crypto';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { enqueueSyncConnector } from '../queue/client.js';
import { getRedisConnection } from '../queue/index.js';
import { apiLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { enqueueSyncAnalytics } from '../queue/client.js';

const router: Router = createRouter();

/**
 * OAuth state expiry (15 minutes)
 */
const OAUTH_STATE_EXPIRY_SECONDS = 15 * 60;

/**
 * Supported OAuth providers
 */
const SUPPORTED_PROVIDERS = ['google'] as const;
type Provider = typeof SUPPORTED_PROVIDERS[number];

/**
 * Validation schemas
 */
const providerParamSchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS),
});

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const googleTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string().optional(),
});

const googleAccountsResponseSchema = z.object({
  accountSummaries: z
    .array(
      z.object({
        propertySummaries: z
          .array(
            z.object({
              property: z.string(),
            })
          )
          .optional(),
      })
    )
    .optional(),
});

/**
 * OAuth state data stored in Redis
 */
interface OAuthState {
  tenantId: string;
  userId: string;
  provider: Provider;
  createdAt: string;
}

/**
 * Mock token exchange response (in production, call actual OAuth provider)
 */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * GET /connectors
 *
 * List all connectors for the authenticated user's tenant
 */
router.get(
  '/',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const userId = req.clerkId!;

      apiLogger.info('Fetching connectors', { tenantId, userId });

      // Get tenant-scoped database client
      const db = createTenantClient({ tenantId, userId });

      // Fetch all connectors for this tenant
      const connectors = await db.connector.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          provider: true,
          status: true,
          lastSyncedAt: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          // Don't include encrypted tokens in the response
        },
      });

      await db.$disconnect();

      return res.status(200).json({
        connectors,
        count: connectors.length,
      });

    } catch (error) {
      apiLogger.error('Error fetching connectors', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        tenantId: req.tenantId,
        userId: req.clerkId,
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch connectors',
        code: 'CONNECTORS_FETCH_ERROR',
      });
    }
  }
);

/**
 * POST /connectors/:provider/authorize
 *
 * Initiate OAuth flow for a connector provider
 * Generates a state token, stores it in Redis, and returns the authorization URL
 */
router.post(
  '/:provider/authorize',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    try {
      // Validate provider parameter
      const paramParseResult = providerParamSchema.safeParse(req.params);

      if (!paramParseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid provider',
          details: paramParseResult.error.format(),
          code: 'INVALID_PROVIDER',
        });
      }

      const { provider } = paramParseResult.data;
      const tenantId = req.tenantId!;
      const userId = req.clerkId!;

      apiLogger.info('Initiating OAuth authorization', {
        provider,
        tenantId,
        userId,
      });

      // Generate secure random state token
      const state = randomBytes(32).toString('hex');

      // Store state in Redis with expiry
      const redis = getRedisConnection();
      const stateData: OAuthState = {
        tenantId,
        userId,
        provider,
        createdAt: new Date().toISOString(),
      };

      await redis.setex(
        `oauth:state:${state}`,
        OAUTH_STATE_EXPIRY_SECONDS,
        JSON.stringify(stateData)
      );

      apiLogger.info('Stored OAuth state in Redis', {
        state,
        provider,
        tenantId,
        expirySeconds: OAUTH_STATE_EXPIRY_SECONDS,
      });

      // Build authorization URL based on provider
      let authorizationUrl: string;

      switch (provider) {
        case 'google': {
          const googleClientId = config.googleClientId || 'demo-client-id';
          const googleRedirectUri =
            config.googleRedirectUri ||
            `http://localhost:${config.port}/connectors/google/callback`;

          // Google Analytics scopes for Phase 2
          const googleScopes = [
            'https://www.googleapis.com/auth/analytics.readonly',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ].join(' ');

          const googleParams = new URLSearchParams({
            client_id: googleClientId,
            redirect_uri: googleRedirectUri,
            response_type: 'code',
            scope: googleScopes,
            access_type: 'offline',
            prompt: 'consent',
            state,
            include_granted_scopes: 'true',
          });

          authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${googleParams.toString()}`;
          break;
        }

        default:
          return res.status(400).json({
            error: 'Bad Request',
            message: `Provider ${provider} not yet implemented`,
            code: 'PROVIDER_NOT_IMPLEMENTED',
          });
      }

      return res.status(200).json({
        authorizationUrl,
        state,
        provider,
        expiresIn: OAUTH_STATE_EXPIRY_SECONDS,
      });

    } catch (error) {
      apiLogger.error('Error initiating OAuth authorization', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        provider: req.params.provider,
        tenantId: req.tenantId,
        userId: req.clerkId,
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to initiate OAuth authorization',
        code: 'OAUTH_AUTHORIZE_ERROR',
      });
    }
  }
);

/**
 * GET /connectors/:provider/callback
 *
 * Handle OAuth callback from provider
 * Validates state, exchanges code for tokens, encrypts tokens, stores in DB, and enqueues sync job
 */
router.get(
  '/:provider/callback',
  async (req: Request, res: Response) => {
    try {
      // Validate provider parameter
      const paramParseResult = providerParamSchema.safeParse(req.params);

      if (!paramParseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid provider',
          details: paramParseResult.error.format(),
          code: 'INVALID_PROVIDER',
        });
      }

      // Validate query parameters
      const queryParseResult = callbackQuerySchema.safeParse(req.query);

      if (!queryParseResult.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid callback parameters',
          details: queryParseResult.error.format(),
          code: 'INVALID_CALLBACK_PARAMS',
        });
      }

      const { provider } = paramParseResult.data;
      const { code, state, error, error_description } = queryParseResult.data;

      // Check for OAuth errors
      if (error) {
        apiLogger.warn('OAuth error received', {
          provider,
          error,
          error_description,
        });

        return res.status(400).json({
          error: 'OAuth Error',
          message: error_description || error,
          code: 'OAUTH_PROVIDER_ERROR',
        });
      }

      apiLogger.info('Received OAuth callback', {
        provider,
        state,
        hasCode: !!code,
      });

      // Retrieve and validate state from Redis
      const redis = getRedisConnection();
      const stateDataJson = await redis.get(`oauth:state:${state}`);

      if (!stateDataJson) {
        apiLogger.warn('Invalid or expired OAuth state', { state });

        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid or expired state token',
          code: 'INVALID_STATE',
        });
      }

      const stateData: OAuthState = JSON.parse(stateDataJson);

      // Validate provider matches
      if (stateData.provider !== provider) {
        apiLogger.warn('Provider mismatch in OAuth callback', {
          expected: stateData.provider,
          received: provider,
        });

        return res.status(400).json({
          error: 'Bad Request',
          message: 'Provider mismatch',
          code: 'PROVIDER_MISMATCH',
        });
      }

      // Delete state from Redis (one-time use)
      await redis.del(`oauth:state:${state}`);

      const { tenantId, userId } = stateData;

      apiLogger.info('Validated OAuth state', {
        provider,
        tenantId,
        userId,
      });

      // Exchange authorization code for tokens
      // In production, this would make a real HTTP request to the OAuth provider
      // For demo purposes, we'll mock the response
      const tokens: TokenResponse = await exchangeCodeForTokens(provider, code);

      apiLogger.info('Exchanged code for tokens', {
        provider,
        tenantId,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });

      // Fetch Google Analytics property ID if applicable
      let analyticsPropertyId: string | null = null;
      if (provider === 'google') {
        analyticsPropertyId = await fetchGoogleAnalyticsProperty(tokens.access_token);
        if (analyticsPropertyId) {
          apiLogger.info('Fetched Google Analytics property', {
            propertyId: analyticsPropertyId,
            tenantId,
          });
        }
      }

      // Encrypt tokens using tenant-specific encryption
      const encryptedAccessToken = encryptForTenant(
        tokens.access_token,
        tenantId,
        'connector-tokens'
      );

      const encryptedRefreshToken = tokens.refresh_token
        ? encryptForTenant(tokens.refresh_token, tenantId, 'connector-tokens')
        : null;

      // Store connector in database
      const db = createTenantClient({ tenantId, userId });

      const connector = await db.connector.create({
        data: {
          tenantId,
          provider,
          status: 'pending',
          encryptedAccessToken,
          encryptedRefreshToken,
          encryptionKeyVersion: getCurrentKeyVersion(),
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          scopes: tokens.scope?.split(' ') || [],
          metadata: {
            tokenType: tokens.token_type,
            propertyId: analyticsPropertyId,
          },
        },
      });

      await db.$disconnect();

      apiLogger.info('Created connector in database', {
        connectorId: connector.id,
        provider,
        tenantId,
      });

      // Enqueue sync job - use analytics sync for Google, regular sync for others
      let jobResult;
      if (provider === 'google' && analyticsPropertyId) {
        jobResult = await enqueueSyncAnalytics(
          tenantId,
          connector.id,
          { triggeredBy: 'oauth-callback' }
        );
        apiLogger.info('Enqueued analytics sync job', {
          connectorId: connector.id,
          jobId: jobResult.jobId,
          tenantId,
        });
      } else {
        jobResult = await enqueueSyncConnector(
          tenantId,
          connector.id,
          { triggeredBy: 'oauth-callback' }
        );
        apiLogger.info('Enqueued connector sync job', {
          connectorId: connector.id,
          jobId: jobResult.jobId,
          tenantId,
        });
      }

      // Return success response
      return res.status(200).json({
        success: true,
        message: 'Connector authorized successfully',
        connector: {
          id: connector.id,
          provider: connector.provider,
          status: connector.status,
          createdAt: connector.createdAt,
        },
        syncJob: {
          jobId: jobResult.jobId,
          queueName: jobResult.queueName,
        },
      });

    } catch (error) {
      apiLogger.error('Error in OAuth callback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        provider: req.params.provider,
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to complete OAuth callback',
        code: 'OAUTH_CALLBACK_ERROR',
      });
    }
  }
);

/**
 * Exchange authorization code for tokens with real OAuth provider
 */
async function exchangeCodeForTokens(
  provider: Provider,
  code: string
): Promise<TokenResponse> {
  if (provider === 'google') {
    const googleClientId = config.googleClientId;
    const googleClientSecret = config.googleClientSecret;
    const googleRedirectUri = config.googleRedirectUri ||
      `http://localhost:${config.port}/connectors/google/callback`;

    // If no client credentials configured, return mock tokens
    if (!googleClientId || !googleClientSecret) {
      apiLogger.warn('Google OAuth credentials not configured, using mock tokens');
      await new Promise(resolve => setTimeout(resolve, 100));
      return {
        access_token: `mock_access_token_${code}_${Date.now()}`,
        refresh_token: `mock_refresh_token_${code}_${Date.now()}`,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
      };
    }

    // Real token exchange
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => null);
      const errorDescription =
        typeof errorData === 'object' &&
        errorData !== null &&
        'error_description' in errorData &&
        typeof (errorData as Record<string, unknown>).error_description === 'string'
          ? (errorData as Record<string, unknown>).error_description
          : tokenResponse.statusText;
      throw new Error(`Google token exchange failed: ${errorDescription}`);
    }

    const tokenData = googleTokenResponseSchema.parse(await tokenResponse.json());
    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
    };
  }

  // Fallback for unsupported providers
  throw new Error(`Token exchange not implemented for provider: ${provider}`);
}

/**
 * Fetch Google Analytics property ID for the authenticated user
 */
async function fetchGoogleAnalyticsProperty(accessToken: string): Promise<string | null> {
  try {
    // Fetch Analytics accounts
    const accountsResponse = await fetch(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!accountsResponse.ok) {
      apiLogger.warn('Failed to fetch Google Analytics accounts', {
        status: accountsResponse.status,
      });
      return null;
    }

    const accountsData = googleAccountsResponseSchema.parse(
      await accountsResponse.json()
    );

    const accountSummaries = accountsData.accountSummaries ?? [];
    if (accountSummaries.length === 0) {
      return null;
    }

    const firstAccount = accountSummaries[0];
    if (!firstAccount) {
      return null;
    }

    const propertySummaries = firstAccount.propertySummaries ?? [];
    if (propertySummaries.length === 0) {
      return null;
    }

    const propertyName = propertySummaries[0]?.property;
    if (typeof propertyName !== 'string') {
      return null;
    }

    const [, propertyId] = propertyName.split('/');
    return propertyId ?? null;
  } catch (error) {
    apiLogger.error('Error fetching Google Analytics property', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

export default router;
