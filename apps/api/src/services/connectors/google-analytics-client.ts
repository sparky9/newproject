import { createTenantClient } from '@ocsuite/db';
import { decryptForTenantWithVersion } from '@ocsuite/crypto';
import { apiLogger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { z } from 'zod';
import { parseJsonRecord } from '../../utils/json.js';

const tokenRefreshResponseSchema = z.object({ access_token: z.string() });

export interface AnalyticsData {
  date: string;
  sessions: number;
  users: number;
  conversions: number;
  revenue: number;
  sourceBreakdown: {
    organic: number;
    paid: number;
    social: number;
    direct: number;
    referral: number;
  };
}

interface RunReportDimensionValue {
  value?: string | null;
}

interface RunReportMetricValue {
  value?: string | null;
}

interface RunReportRow {
  dimensionValues?: RunReportDimensionValue[];
  metricValues?: RunReportMetricValue[];
}

interface RunReportResponse {
  rows?: RunReportRow[];
}

/**
 * Google Analytics Data API v1 Client
 *
 * Provides methods to fetch analytics data from Google Analytics 4 properties
 */
export class GoogleAnalyticsClient {
  private accessToken: string;
  private propertyId: string;

  constructor(accessToken: string, propertyId: string) {
    this.accessToken = accessToken;
    this.propertyId = propertyId;
  }

  /**
   * Create a GoogleAnalyticsClient from a stored connector
   *
   * @param tenantId - Tenant ID
   * @param connectorId - Connector ID
   * @returns GoogleAnalyticsClient instance
   */
  static async fromConnector(tenantId: string, connectorId: string): Promise<GoogleAnalyticsClient> {
    const prisma = createTenantClient({ tenantId });

    try {
      const connector = await prisma.connector.findUnique({
        where: { id: connectorId },
      });

      if (!connector) {
        throw new Error('Connector not found');
      }

      if (connector.provider !== 'google') {
        throw new Error('Connector is not a Google connector');
      }

      if (connector.status === 'disconnected') {
        throw new Error('Connector is disconnected');
      }

  // Decrypt access token with the stored key version (default to legacy version 1)
  const keyVersion = connector.encryptionKeyVersion ?? 1;
      const decrypted = decryptForTenantWithVersion(
        connector.encryptedAccessToken,
        tenantId,
        'connector-tokens',
        keyVersion
      );

      // Parse tokens (stored as JSON string or plain token)
      let accessToken: string;
      try {
        const tokens = JSON.parse(decrypted);
        accessToken = tokens.accessToken || tokens.access_token;
      } catch {
        accessToken = decrypted;
      }

      // Get property ID from metadata
      const metadataRecord = connector.metadata ? parseJsonRecord(connector.metadata) : {};
      const propertyIdValue = metadataRecord.propertyId;
      const propertyId = typeof propertyIdValue === 'string' ? propertyIdValue : undefined;

      if (!propertyId) {
        throw new Error('Analytics property ID not configured');
      }

      return new GoogleAnalyticsClient(accessToken, propertyId);
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Fetch analytics data for a date range
   *
   * @param startDate - Start date in YYYY-MM-DD format
   * @param endDate - End date in YYYY-MM-DD format
   * @returns Array of analytics data by date
   */
  async fetchAnalytics(startDate: string, endDate: string): Promise<AnalyticsData[]> {
    apiLogger.info('Fetching Google Analytics data', {
      propertyId: this.propertyId,
      startDate,
      endDate,
    });

    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${this.propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          dimensions: [
            { name: 'date' },
            { name: 'sessionDefaultChannelGroup' },
          ],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'conversions' },
            { name: 'totalRevenue' },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      apiLogger.error('Google Analytics API error', {
        status: response.status,
        error: errorData,
      });
      throw new Error(`Google Analytics API error: ${response.status}`);
    }

    const data = await response.json();
    if (!this.isRunReportResponse(data)) {
      apiLogger.error('Unexpected analytics response shape', {
        hasRowsProperty: typeof data === 'object' && data !== null && 'rows' in data,
      });
      return [];
    }
    return this.parseAnalyticsResponse(data);
  }

  /**
   * Parse Google Analytics API response into structured data
   *
   * @param data - Raw API response
   * @returns Parsed analytics data by date
   */
  private parseAnalyticsResponse(data: RunReportResponse): AnalyticsData[] {
    const byDate = new Map<string, AnalyticsData>();
    const rows = Array.isArray(data.rows) ? data.rows : [];

    if (rows.length === 0) {
      apiLogger.warn('No analytics data returned from API');
      return [];
    }

    const parseInteger = (value: string | null | undefined): number => {
      const parsed = Number.parseInt(value ?? '0', 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const parseFloatValue = (value: string | null | undefined): number => {
      const parsed = Number.parseFloat(value ?? '0');
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    for (const row of rows) {
      const dimensionValues = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
      const metricValues = Array.isArray(row.metricValues) ? row.metricValues : [];

      if (dimensionValues.length < 2 || metricValues.length < 4) {
        apiLogger.warn('Skipping analytics row with missing dimensions or metrics');
        continue;
      }

      const date = dimensionValues[0]?.value ?? undefined;
      const source = dimensionValues[1]?.value ?? undefined;

      if (!date || !source) {
        apiLogger.warn('Skipping analytics row with missing date or source');
        continue;
      }

      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          sessions: 0,
          users: 0,
          conversions: 0,
          revenue: 0,
          sourceBreakdown: {
            organic: 0,
            paid: 0,
            social: 0,
            direct: 0,
            referral: 0,
          },
        });
      }

      const entry = byDate.get(date)!;
      const sessions = parseInteger(metricValues[0]?.value);
      const users = parseInteger(metricValues[1]?.value);
      const conversions = parseInteger(metricValues[2]?.value);
      const revenue = parseFloatValue(metricValues[3]?.value);

      entry.sessions += sessions;
      entry.users += users;
      entry.conversions += conversions;
      entry.revenue += revenue;

      const sourceKey = this.mapSourceToCategory(source);
      entry.sourceBreakdown[sourceKey] += sessions;
    }

    return Array.from(byDate.values());
  }

  private isRunReportResponse(data: unknown): data is RunReportResponse {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const rows = (data as { rows?: unknown }).rows;
    if (rows === undefined) {
      return true;
    }

    if (!Array.isArray(rows)) {
      return false;
    }

    return rows.every((row) => {
      if (typeof row !== 'object' || row === null) {
        return false;
      }

      const { dimensionValues, metricValues } = row as RunReportRow;
      const dimensionsValid =
        dimensionValues === undefined ||
        (Array.isArray(dimensionValues) &&
          dimensionValues.every((value) =>
            value === undefined || value === null || typeof value === 'object'
          ));
      const metricsValid =
        metricValues === undefined ||
        (Array.isArray(metricValues) &&
          metricValues.every((value) =>
            value === undefined || value === null || typeof value === 'object'
          ));

      return dimensionsValid && metricsValid;
    });
  }

  /**
   * Map Google Analytics channel group to source category
   *
   * @param source - Channel group name
   * @returns Source category key
   */
  private mapSourceToCategory(source: string): keyof AnalyticsData['sourceBreakdown'] {
    const lower = source.toLowerCase();

  if (lower.includes('paid') || lower.includes('cpc') || lower.includes('display')) return 'paid';
  if (lower.includes('organic') || lower.includes('search')) return 'organic';
    if (lower.includes('social')) return 'social';
    if (lower.includes('direct')) return 'direct';

    return 'referral';
  }

  /**
   * Refresh the access token using the refresh token
   *
   * @param refreshToken - Refresh token
   * @returns New access token
   */
  async refreshAccessToken(refreshToken: string): Promise<string> {
    const googleClientId = config.googleClientId;
    const googleClientSecret = config.googleClientSecret;

    if (!googleClientId || !googleClientSecret) {
      throw new Error('Google OAuth credentials not configured');
    }

    apiLogger.info('Refreshing Google access token');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorDescription =
        typeof errorData === 'object' &&
        errorData !== null &&
        'error_description' in errorData &&
        typeof (errorData as Record<string, unknown>).error_description === 'string'
          ? (errorData as Record<string, unknown>).error_description
          : response.statusText;

      apiLogger.error('Failed to refresh Google access token', {
        status: response.status,
        error: errorData,
      });
      throw new Error(`Token refresh failed: ${errorDescription}`);
    }

    const data = tokenRefreshResponseSchema.parse(await response.json());
    return data.access_token;
  }
}
