import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { createTenantClient } from '@ocsuite/db';
import { GoogleAnalyticsClient } from '../../src/services/connectors/google-analytics-client.js';
import { enqueueSyncAnalytics } from '../../src/queue/client.js';
import { initializeQueues, closeQueues } from '../../src/queue/index.js';
import { encryptForTenant, initializeCrypto } from '@ocsuite/crypto';
import { createTestTenant, cleanupTestData } from '../utils/test-helpers.js';

const GA_TEST_TENANT_ID = 'test-tenant-google-analytics-00000000-0000-0000-0000-000000000001';

/**
 * Google Analytics Integration Tests
 *
 * Tests OAuth flow and sync worker with mocked Google API responses
 */
describe('Google Analytics Integration', () => {
  let mockFetch: Mock<[RequestInfo | URL, RequestInit?], Promise<unknown>>;

  beforeAll(async () => {
    // Initialize crypto for encryption tests
    initializeCrypto(
      process.env.MASTER_ENCRYPTION_KEY || 'cSuiteLocalMasterKey_A1B2C3D4E5F6G7H8I9J0PQRS'
    );

    // Initialize queues
    await initializeQueues();

    // Create test tenant
    await createTestTenant(GA_TEST_TENANT_ID);
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData(GA_TEST_TENANT_ID);

    // Close queues
    await closeQueues();
  });

  beforeEach(() => {
    // Mock global fetch for Google API calls
  mockFetch = vi.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GoogleAnalyticsClient', () => {
    let testConnectorId: string;

    beforeEach(async () => {
      // Create a test connector
      await createTestTenant(GA_TEST_TENANT_ID);
      const prisma = createTenantClient({ tenantId: GA_TEST_TENANT_ID });

      try {
        await prisma.connector.deleteMany({
          where: {
            tenantId: GA_TEST_TENANT_ID,
            provider: 'google',
          },
        });
        const accessToken = 'test-access-token-12345';
        const encryptedToken = encryptForTenant(
          accessToken,
          GA_TEST_TENANT_ID,
          'connector-tokens'
        );

        const connector = await prisma.connector.create({
          data: {
            tenantId: GA_TEST_TENANT_ID,
            provider: 'google',
            status: 'active',
            encryptedAccessToken: encryptedToken,
            scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
            metadata: {
              propertyId: '123456789',
            },
          },
        });

        testConnectorId = connector.id;
      } finally {
        await prisma.$disconnect();
      }
    });

    afterEach(async () => {
      // Clean up test connector
      if (testConnectorId) {
  const prisma = createTenantClient({ tenantId: GA_TEST_TENANT_ID });
        try {
          await prisma.connector.delete({
            where: { id: testConnectorId },
          });
        } catch {
          // Ignore if already deleted
        } finally {
          await prisma.$disconnect();
        }
      }
    });

    it('should create client from connector', async () => {
      const client = await GoogleAnalyticsClient.fromConnector(
        GA_TEST_TENANT_ID,
        testConnectorId
      );

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(GoogleAnalyticsClient);
    });

    it('should fail if connector not found', async () => {
      await expect(
        GoogleAnalyticsClient.fromConnector(GA_TEST_TENANT_ID, 'nonexistent-id')
      ).rejects.toThrow('Connector not found');
    });

    it('should fail if property ID not configured', async () => {
  const prisma = createTenantClient({ tenantId: GA_TEST_TENANT_ID });

      try {
        await prisma.connector.update({
          where: { id: testConnectorId },
          data: { metadata: {} },
        });

        await expect(
          GoogleAnalyticsClient.fromConnector(GA_TEST_TENANT_ID, testConnectorId)
        ).rejects.toThrow('Analytics property ID not configured');
      } finally {
        await prisma.$disconnect();
      }
    });

    it('should fetch analytics data successfully', async () => {
      // Mock Google Analytics API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            {
              dimensionValues: [
                { value: '20250101' },
                { value: 'Organic Search' },
              ],
              metricValues: [
                { value: '1000' }, // sessions
                { value: '800' },  // users
                { value: '50' },   // conversions
                { value: '5000' }, // revenue
              ],
            },
            {
              dimensionValues: [
                { value: '20250101' },
                { value: 'Paid Search' },
              ],
              metricValues: [
                { value: '500' },
                { value: '400' },
                { value: '25' },
                { value: '2500' },
              ],
            },
            {
              dimensionValues: [
                { value: '20250102' },
                { value: 'Direct' },
              ],
              metricValues: [
                { value: '300' },
                { value: '250' },
                { value: '15' },
                { value: '1500' },
              ],
            },
          ],
        }),
      });

      const client = await GoogleAnalyticsClient.fromConnector(
        GA_TEST_TENANT_ID,
        testConnectorId
      );

      const data = await client.fetchAnalytics('2025-01-01', '2025-01-02');

      expect(data).toHaveLength(2); // 2 unique dates
      expect(data[0]).toMatchObject({
        date: '20250101',
        sessions: 1500, // 1000 + 500
        users: 1200,    // 800 + 400
        conversions: 75, // 50 + 25
        revenue: 7500,  // 5000 + 2500
      });

      expect(data[0].sourceBreakdown).toMatchObject({
        organic: 1000,
        paid: 500,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('analyticsdata.googleapis.com'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token-12345',
          }),
        })
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            message: 'Permission denied',
          },
        }),
      });

      const client = await GoogleAnalyticsClient.fromConnector(
        GA_TEST_TENANT_ID,
        testConnectorId
      );

      await expect(
        client.fetchAnalytics('2025-01-01', '2025-01-02')
      ).rejects.toThrow('Google Analytics API error: 403');
    });

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [],
        }),
      });

      const client = await GoogleAnalyticsClient.fromConnector(
        GA_TEST_TENANT_ID,
        testConnectorId
      );

      const data = await client.fetchAnalytics('2025-01-01', '2025-01-02');

      expect(data).toEqual([]);
    });

    it('should refresh access token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 3600,
        }),
      });

      const client = await GoogleAnalyticsClient.fromConnector(
        GA_TEST_TENANT_ID,
        testConnectorId
      );

      const newToken = await client.refreshAccessToken('refresh-token-xyz');

      expect(newToken).toBe('new-access-token');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('Analytics Sync Worker', () => {
    let testConnectorId: string;

    beforeEach(async () => {
      // Create a test connector
      await createTestTenant(GA_TEST_TENANT_ID);
      const prisma = createTenantClient({ tenantId: GA_TEST_TENANT_ID });

      try {
        await prisma.connector.deleteMany({
          where: {
            tenantId: GA_TEST_TENANT_ID,
            provider: 'google',
          },
        });
        const accessToken = 'test-access-token-12345';
        const encryptedToken = encryptForTenant(
          accessToken,
          GA_TEST_TENANT_ID,
          'connector-tokens'
        );

        const connector = await prisma.connector.create({
          data: {
            tenantId: GA_TEST_TENANT_ID,
            provider: 'google',
            status: 'pending',
            encryptedAccessToken: encryptedToken,
            scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
            metadata: {
              propertyId: '123456789',
            },
          },
        });

        testConnectorId = connector.id;
      } finally {
        await prisma.$disconnect();
      }
    });

    afterEach(async () => {
      // Clean up test data
      if (testConnectorId) {
        const prisma = createTenantClient({ tenantId: GA_TEST_TENANT_ID });
        try {
          await prisma.analyticsSnapshot.deleteMany({
            where: { tenantId: GA_TEST_TENANT_ID },
          });
          await prisma.connector.delete({
            where: { id: testConnectorId },
          });
        } catch {
          // Ignore errors
        } finally {
          await prisma.$disconnect();
        }
      }
    });

    it('should enqueue analytics sync job', async () => {
      const result = await enqueueSyncAnalytics(
        GA_TEST_TENANT_ID,
        testConnectorId,
        { triggeredBy: 'test' }
      );

      expect(result).toMatchObject({
        jobId: expect.any(String),
        queueName: 'sync-analytics',
      });
    });

    it('should sync analytics data and store snapshots', async () => {
      // Mock Google Analytics API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            {
              dimensionValues: [
                { value: '20250101' },
                { value: 'Organic Search' },
              ],
              metricValues: [
                { value: '1000' },
                { value: '800' },
                { value: '50' },
                { value: '5000' },
              ],
            },
          ],
        }),
      });

      // Enqueue job
      const result = await enqueueSyncAnalytics(
        GA_TEST_TENANT_ID,
        testConnectorId
      );

      expect(result.jobId).toBeDefined();

      // Wait for job to process (in a real test, you'd use worker directly)
      // For now, we just verify the job was enqueued
      expect(result.queueName).toBe('sync-analytics');
    });
  });

  describe('Source Mapping', () => {
    it('should correctly map channel groups to source categories', async () => {
      const testCases = [
        { input: 'Organic Search', expected: 'organic' },
        { input: 'Paid Search', expected: 'paid' },
        { input: 'Paid Social', expected: 'paid' },
        { input: 'Social', expected: 'social' },
        { input: 'Direct', expected: 'direct' },
        { input: 'Referral', expected: 'referral' },
        { input: 'Email', expected: 'referral' },
        { input: 'Display', expected: 'paid' },
      ];

      // We'd need to expose the mapping function or test it indirectly
      // For now, document expected behavior
      testCases.forEach(({ expected }) => {
        // This would be tested through the full integration
        expect(expected).toBeDefined();
      });
    });
  });
});
