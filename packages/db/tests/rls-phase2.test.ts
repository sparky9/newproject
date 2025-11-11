import { describe, it, expect } from 'vitest';
import {
  setRLSTenantContext,
  withTenantContext,
} from '../src/index';
import {
  testPrisma,
  TENANT_1_ID,
  TENANT_2_ID,
  createTestModuleInsight,
  createTestAnalyticsSnapshot,
  createTestConnector,
} from './setup';

/**
 * Phase 2 RLS Tests
 *
 * Tests Row-Level Security (RLS) policies for Phase 2 tables:
 * - ModuleInsight
 * - AnalyticsSnapshot
 *
 * These tests verify that tenant isolation is properly enforced at the database level,
 * preventing cross-tenant data access even with raw SQL queries.
 */
describe('Phase 2: Row Level Security (RLS) Policies', () => {
  describe('ModuleInsight RLS Policies', () => {
    describe('SELECT Policy', () => {
      it('should only return insights for the current tenant', async () => {
        // Create insights for both tenants
        await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'info',
          'Tenant 1 Growth Insight'
        );
        await createTestModuleInsight(
          TENANT_1_ID,
          'churn-watch',
          'warning',
          'Tenant 1 Churn Insight'
        );
        await createTestModuleInsight(
          TENANT_2_ID,
          'growth-pulse',
          'critical',
          'Tenant 2 Growth Insight'
        );

        // Query as tenant 1
        const tenant1Insights = await withTenantContext(
          testPrisma,
          TENANT_1_ID,
          async (tx) => {
            return tx.moduleInsight.findMany();
          }
        );

        expect(tenant1Insights).toHaveLength(2);
        tenant1Insights.forEach((insight) => {
          expect(insight.tenantId).toBe(TENANT_1_ID);
        });

        // Query as tenant 2
        const tenant2Insights = await withTenantContext(
          testPrisma,
          TENANT_2_ID,
          async (tx) => {
            return tx.moduleInsight.findMany();
          }
        );

        expect(tenant2Insights).toHaveLength(1);
        expect(tenant2Insights[0].tenantId).toBe(TENANT_2_ID);
      });

      it('should enforce RLS with raw SQL queries', async () => {
        // Create insights for both tenants
        await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'info',
          'Tenant 1 Insight'
        );
        await createTestModuleInsight(
          TENANT_2_ID,
          'growth-pulse',
          'info',
          'Tenant 2 Insight'
        );

        // Raw query as tenant 1
        const results = await withTenantContext(
          testPrisma,
          TENANT_1_ID,
          async (tx) => {
            return tx.$queryRaw<
              Array<{ id: string; tenant_id: string; summary: string }>
            >`
              SELECT id, tenant_id, summary FROM module_insights
            `;
          }
        );

        expect(results).toHaveLength(1);
        expect(results[0].tenant_id).toBe(TENANT_1_ID);
      });

      it('should filter by module slug within tenant context', async () => {
        // Create multiple insights for tenant 1
        await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'info',
          'Growth Insight 1'
        );
        await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'warning',
          'Growth Insight 2'
        );
        await createTestModuleInsight(
          TENANT_1_ID,
          'churn-watch',
          'critical',
          'Churn Insight'
        );

        // Query for specific module
        const growthInsights = await withTenantContext(
          testPrisma,
          TENANT_1_ID,
          async (tx) => {
            return tx.moduleInsight.findMany({
              where: { moduleSlug: 'growth-pulse' },
            });
          }
        );

        expect(growthInsights).toHaveLength(2);
        growthInsights.forEach((insight) => {
          expect(insight.moduleSlug).toBe('growth-pulse');
          expect(insight.tenantId).toBe(TENANT_1_ID);
        });
      });
    });

    describe('INSERT Policy', () => {
      it('should allow INSERT with matching tenant context', async () => {
        await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          const insight = await tx.moduleInsight.create({
            data: {
              tenantId: TENANT_1_ID,
              moduleSlug: 'growth-pulse',
              severity: 'info',
              summary: 'Test insight',
              highlights: ['Test highlight'],
              actionItems: { items: [] },
            },
          });

          expect(insight.tenantId).toBe(TENANT_1_ID);
          expect(insight.moduleSlug).toBe('growth-pulse');
        });
      });

      it('should block INSERT with mismatched tenant context', async () => {
        // Try to insert tenant 2 data while context is tenant 1
        await expect(
          withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
            return tx.moduleInsight.create({
              data: {
                tenantId: TENANT_2_ID, // Mismatch!
                moduleSlug: 'growth-pulse',
                severity: 'critical',
                summary: 'Malicious insight',
                highlights: ['Bad highlight'],
                actionItems: { items: [] },
              },
            });
          })
        ).rejects.toThrow();
      });

      it('should block raw INSERT with mismatched tenant context', async () => {
        await expect(
          withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
            return tx.$executeRaw`
              INSERT INTO module_insights (
                id, tenant_id, module_slug, severity, summary,
                highlights, action_items, created_at, updated_at
              )
              VALUES (
                gen_random_uuid(), ${TENANT_2_ID}, 'growth-pulse',
                'info', 'Test', ARRAY[]::text[], '{}'::jsonb,
                now(), now()
              )
            `;
          })
        ).rejects.toThrow();
      });
    });

    describe('UPDATE Policy', () => {
      it('should allow UPDATE within tenant context', async () => {
        // Create insight for tenant 1
        const insight = await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'info',
          'Original Summary'
        );

        // Update as tenant 1
        await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          await tx.moduleInsight.update({
            where: { id: insight.id },
            data: { summary: 'Updated Summary', severity: 'warning' },
          });
        });

        // Verify update
        const updated = await testPrisma.moduleInsight.findUnique({
          where: { id: insight.id },
        });
        expect(updated?.summary).toBe('Updated Summary');
        expect(updated?.severity).toBe('warning');
      });

      it('should block UPDATE from different tenant context', async () => {
        // Create insight for tenant 1
        const insight = await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'info',
          'Original Summary'
        );

        // Try to update as tenant 2
        await expect(
          withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
            return tx.moduleInsight.update({
              where: { id: insight.id },
              data: { summary: 'Malicious Update' },
            });
          })
        ).rejects.toThrow();

        // Verify original unchanged
        const unchanged = await testPrisma.moduleInsight.findUnique({
          where: { id: insight.id },
        });
        expect(unchanged?.summary).toBe('Original Summary');
      });

      it('should prevent updating tenantId to different tenant', async () => {
        // Create insight for tenant 1
        const insight = await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'info',
          'Test Insight'
        );

        // Try to change tenantId (should fail RLS check)
        await expect(
          withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
            return tx.moduleInsight.update({
              where: { id: insight.id },
              data: { tenantId: TENANT_2_ID },
            });
          })
        ).rejects.toThrow();
      });
    });

    describe('DELETE Policy', () => {
      it('should allow DELETE within tenant context', async () => {
        // Create insight for tenant 1
        const insight = await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'info',
          'Test Insight'
        );

        // Delete as tenant 1
        await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          await tx.moduleInsight.delete({
            where: { id: insight.id },
          });
        });

        // Verify deletion
        const deleted = await testPrisma.moduleInsight.findUnique({
          where: { id: insight.id },
        });
        expect(deleted).toBeNull();
      });

      it('should block DELETE from different tenant context', async () => {
        // Create insight for tenant 1
        const insight = await createTestModuleInsight(
          TENANT_1_ID,
          'growth-pulse',
          'info',
          'Test Insight'
        );

        // Try to delete as tenant 2
        await expect(
          withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
            return tx.moduleInsight.delete({
              where: { id: insight.id },
            });
          })
        ).rejects.toThrow();

        // Verify insight still exists
        const stillExists = await testPrisma.moduleInsight.findUnique({
          where: { id: insight.id },
        });
        expect(stillExists).not.toBeNull();
      });
    });
  });

  describe('AnalyticsSnapshot RLS Policies', () => {
    describe('SELECT Policy', () => {
      it('should only return snapshots for the current tenant', async () => {
        const today = new Date('2024-01-15');
        const yesterday = new Date('2024-01-14');

        // Create snapshots for both tenants
        await createTestAnalyticsSnapshot(TENANT_1_ID, today);
        await createTestAnalyticsSnapshot(TENANT_1_ID, yesterday);
        await createTestAnalyticsSnapshot(TENANT_2_ID, today);

        // Query as tenant 1
        const tenant1Snapshots = await withTenantContext(
          testPrisma,
          TENANT_1_ID,
          async (tx) => {
            return tx.analyticsSnapshot.findMany();
          }
        );

        expect(tenant1Snapshots).toHaveLength(2);
        tenant1Snapshots.forEach((snapshot) => {
          expect(snapshot.tenantId).toBe(TENANT_1_ID);
        });

        // Query as tenant 2
        const tenant2Snapshots = await withTenantContext(
          testPrisma,
          TENANT_2_ID,
          async (tx) => {
            return tx.analyticsSnapshot.findMany();
          }
        );

        expect(tenant2Snapshots).toHaveLength(1);
        expect(tenant2Snapshots[0].tenantId).toBe(TENANT_2_ID);
      });

      it('should enforce RLS with raw SQL queries', async () => {
        const today = new Date('2024-01-15');

        // Create snapshots for both tenants
        await createTestAnalyticsSnapshot(TENANT_1_ID, today, undefined, 100);
        await createTestAnalyticsSnapshot(TENANT_2_ID, today, undefined, 200);

        // Raw query as tenant 1
        const results = await withTenantContext(
          testPrisma,
          TENANT_1_ID,
          async (tx) => {
            return tx.$queryRaw<
              Array<{ id: string; tenant_id: string; sessions: number }>
            >`
              SELECT id, tenant_id, sessions FROM analytics_snapshots
            `;
          }
        );

        expect(results).toHaveLength(1);
        expect(results[0].tenant_id).toBe(TENANT_1_ID);
        expect(results[0].sessions).toBe(100);
      });

      it('should filter by date range within tenant context', async () => {
        const dates = [
          new Date('2024-01-10'),
          new Date('2024-01-15'),
          new Date('2024-01-20'),
        ];

        // Create snapshots for tenant 1
        for (const date of dates) {
          await createTestAnalyticsSnapshot(TENANT_1_ID, date);
        }

        // Query for specific date range
        const rangeSnapshots = await withTenantContext(
          testPrisma,
          TENANT_1_ID,
          async (tx) => {
            return tx.analyticsSnapshot.findMany({
              where: {
                date: {
                  gte: new Date('2024-01-12'),
                  lte: new Date('2024-01-18'),
                },
              },
            });
          }
        );

        expect(rangeSnapshots).toHaveLength(1);
        expect(rangeSnapshots[0].date).toEqual(new Date('2024-01-15'));
      });

      it('should include connector relationship within tenant context', async () => {
        const today = new Date('2024-01-15');

        // Create connector for tenant 1
        const connector = await createTestConnector(TENANT_1_ID, 'google');

        // Create snapshot with connector
        await createTestAnalyticsSnapshot(
          TENANT_1_ID,
          today,
          connector.id,
          150
        );

        // Query with connector relation
        const snapshots = await withTenantContext(
          testPrisma,
          TENANT_1_ID,
          async (tx) => {
            return tx.analyticsSnapshot.findMany({
              include: { connector: true },
            });
          }
        );

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].connectorId).toBe(connector.id);
        expect(snapshots[0].connector).not.toBeNull();
        expect(snapshots[0].connector?.provider).toBe('google');
      });
    });

    describe('INSERT Policy', () => {
      it('should allow INSERT with matching tenant context', async () => {
        const today = new Date('2024-01-15');

        await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          const snapshot = await tx.analyticsSnapshot.create({
            data: {
              tenantId: TENANT_1_ID,
              date: today,
              sessions: 100,
              users: 50,
              conversions: 10,
              revenue: 1000.0,
              sourceBreakdown: { organic: 60, paid: 40 },
            },
          });

          expect(snapshot.tenantId).toBe(TENANT_1_ID);
          expect(snapshot.sessions).toBe(100);
        });
      });

      it('should block INSERT with mismatched tenant context', async () => {
        const today = new Date('2024-01-15');

        // Try to insert tenant 2 data while context is tenant 1
        await expect(
          withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
            return tx.analyticsSnapshot.create({
              data: {
                tenantId: TENANT_2_ID, // Mismatch!
                date: today,
                sessions: 999,
                users: 999,
                conversions: 999,
                revenue: 9999.0,
                sourceBreakdown: { hacked: 100 },
              },
            });
          })
        ).rejects.toThrow();
      });

      it('should enforce unique constraint per tenant per date', async () => {
        const today = new Date('2024-01-15');

        // Create first snapshot
        await createTestAnalyticsSnapshot(TENANT_1_ID, today);

        // Try to create second snapshot for same tenant and date
        await expect(
          createTestAnalyticsSnapshot(TENANT_1_ID, today)
        ).rejects.toThrow();
      });

      it('should allow same date for different tenants', async () => {
        const today = new Date('2024-01-15');

        // Create snapshots for both tenants with same date
        await createTestAnalyticsSnapshot(TENANT_1_ID, today, undefined, 100);
        await createTestAnalyticsSnapshot(TENANT_2_ID, today, undefined, 200);

        // Both should exist
        const tenant1Snapshot = await withTenantContext(
          testPrisma,
          TENANT_1_ID,
          async (tx) => {
            return tx.analyticsSnapshot.findFirst({
              where: { date: today },
            });
          }
        );

        const tenant2Snapshot = await withTenantContext(
          testPrisma,
          TENANT_2_ID,
          async (tx) => {
            return tx.analyticsSnapshot.findFirst({
              where: { date: today },
            });
          }
        );

        expect(tenant1Snapshot).not.toBeNull();
        expect(tenant2Snapshot).not.toBeNull();
        expect(tenant1Snapshot?.sessions).toBe(100);
        expect(tenant2Snapshot?.sessions).toBe(200);
      });
    });

    describe('UPDATE Policy', () => {
      it('should allow UPDATE within tenant context', async () => {
        const today = new Date('2024-01-15');

        // Create snapshot for tenant 1
        const snapshot = await createTestAnalyticsSnapshot(
          TENANT_1_ID,
          today,
          undefined,
          100,
          50
        );

        // Update as tenant 1
        await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          await tx.analyticsSnapshot.update({
            where: { id: snapshot.id },
            data: { sessions: 150, users: 75 },
          });
        });

        // Verify update
        const updated = await testPrisma.analyticsSnapshot.findUnique({
          where: { id: snapshot.id },
        });
        expect(updated?.sessions).toBe(150);
        expect(updated?.users).toBe(75);
      });

      it('should block UPDATE from different tenant context', async () => {
        const today = new Date('2024-01-15');

        // Create snapshot for tenant 1
        const snapshot = await createTestAnalyticsSnapshot(
          TENANT_1_ID,
          today,
          undefined,
          100
        );

        // Try to update as tenant 2
        await expect(
          withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
            return tx.analyticsSnapshot.update({
              where: { id: snapshot.id },
              data: { sessions: 999 },
            });
          })
        ).rejects.toThrow();

        // Verify original unchanged
        const unchanged = await testPrisma.analyticsSnapshot.findUnique({
          where: { id: snapshot.id },
        });
        expect(unchanged?.sessions).toBe(100);
      });

      it('should prevent updating tenantId to different tenant', async () => {
        const today = new Date('2024-01-15');

        // Create snapshot for tenant 1
        const snapshot = await createTestAnalyticsSnapshot(TENANT_1_ID, today);

        // Try to change tenantId (should fail RLS check)
        await expect(
          withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
            return tx.analyticsSnapshot.update({
              where: { id: snapshot.id },
              data: { tenantId: TENANT_2_ID },
            });
          })
        ).rejects.toThrow();
      });
    });

    describe('DELETE Policy', () => {
      it('should allow DELETE within tenant context', async () => {
        const today = new Date('2024-01-15');

        // Create snapshot for tenant 1
        const snapshot = await createTestAnalyticsSnapshot(TENANT_1_ID, today);

        // Delete as tenant 1
        await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          await tx.analyticsSnapshot.delete({
            where: { id: snapshot.id },
          });
        });

        // Verify deletion
        const deleted = await testPrisma.analyticsSnapshot.findUnique({
          where: { id: snapshot.id },
        });
        expect(deleted).toBeNull();
      });

      it('should block DELETE from different tenant context', async () => {
        const today = new Date('2024-01-15');

        // Create snapshot for tenant 1
        const snapshot = await createTestAnalyticsSnapshot(TENANT_1_ID, today);

        // Try to delete as tenant 2
        await expect(
          withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
            return tx.analyticsSnapshot.delete({
              where: { id: snapshot.id },
            });
          })
        ).rejects.toThrow();

        // Verify snapshot still exists
        const stillExists = await testPrisma.analyticsSnapshot.findUnique({
          where: { id: snapshot.id },
        });
        expect(stillExists).not.toBeNull();
      });
    });

    describe('Connector Cascade Behavior', () => {
      it('should set connectorId to null when connector is deleted', async () => {
        const today = new Date('2024-01-15');

        // Create connector for tenant 1
        const connector = await createTestConnector(TENANT_1_ID, 'google');

        // Create snapshot linked to connector
        const snapshot = await createTestAnalyticsSnapshot(
          TENANT_1_ID,
          today,
          connector.id
        );

        expect(snapshot.connectorId).toBe(connector.id);

        // Delete connector
        await testPrisma.connector.delete({
          where: { id: connector.id },
        });

        // Verify snapshot still exists but connectorId is null
        const updatedSnapshot = await testPrisma.analyticsSnapshot.findUnique({
          where: { id: snapshot.id },
        });

        expect(updatedSnapshot).not.toBeNull();
        expect(updatedSnapshot?.connectorId).toBeNull();
      });
    });
  });

  describe('Phase 2 RLS Performance', () => {
    it('should efficiently query large datasets with RLS enabled', async () => {
      // Create many insights for tenant 1
      const insightPromises = [];
      for (let i = 0; i < 30; i++) {
        insightPromises.push(
          createTestModuleInsight(
            TENANT_1_ID,
            'growth-pulse',
            'info',
            `Insight ${i}`
          )
        );
      }

      // Create snapshots for tenant 1
      const snapshotPromises = [];
      for (let i = 0; i < 30; i++) {
        const date = new Date(2024, 0, i + 1);
        snapshotPromises.push(createTestAnalyticsSnapshot(TENANT_1_ID, date));
      }

      await Promise.all([...insightPromises, ...snapshotPromises]);

      // Create data for tenant 2
      for (let i = 0; i < 30; i++) {
        await createTestModuleInsight(
          TENANT_2_ID,
          'churn-watch',
          'warning',
          `Insight ${i}`
        );
      }

      // Query with RLS should be fast and only return tenant 1 data
      const startTime = Date.now();

      const results = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          const insights = await tx.moduleInsight.findMany();
          const snapshots = await tx.analyticsSnapshot.findMany();
          return { insights, snapshots };
        }
      );

      const endTime = Date.now();

  expect(results.insights).toHaveLength(30);
  expect(results.snapshots).toHaveLength(30);
  expect(endTime - startTime).toBeLessThanOrEqual(1500); // Allow modest wiggle to avoid CI flake

      // Verify all results belong to tenant 1
      results.insights.forEach((insight) => {
        expect(insight.tenantId).toBe(TENANT_1_ID);
      });
      results.snapshots.forEach((snapshot) => {
        expect(snapshot.tenantId).toBe(TENANT_1_ID);
      });
    });
  });

  describe('Combined Phase 1 and Phase 2 RLS', () => {
    it('should enforce RLS across all tables simultaneously', async () => {
      const today = new Date('2024-01-15');

      // Create connector for tenant 1
      const connector = await createTestConnector(TENANT_1_ID, 'google');

      // Create insight for tenant 1
      await createTestModuleInsight(
        TENANT_1_ID,
        'growth-pulse',
        'info',
        'Test Insight'
      );

      // Create snapshot for tenant 1 linked to connector
      await createTestAnalyticsSnapshot(
        TENANT_1_ID,
        today,
        connector.id,
        200,
        100,
        20,
        2000
      );

      // Query all Phase 2 tables as tenant 1
      const tenant1Results = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          const insights = await tx.moduleInsight.findMany();
          const snapshots = await tx.analyticsSnapshot.findMany({
            include: { connector: true },
          });
          const connectors = await tx.connector.findMany();

          return { insights, snapshots, connectors };
        }
      );

      // Verify tenant 1 sees all their data
      expect(tenant1Results.insights).toHaveLength(1);
      expect(tenant1Results.snapshots).toHaveLength(1);
      expect(tenant1Results.connectors).toHaveLength(1);
      expect(tenant1Results.snapshots[0].connector).not.toBeNull();

      // Query as tenant 2 should return empty results
      const tenant2Results = await withTenantContext(
        testPrisma,
        TENANT_2_ID,
        async (tx) => {
          const insights = await tx.moduleInsight.findMany();
          const snapshots = await tx.analyticsSnapshot.findMany();
          const connectors = await tx.connector.findMany();

          return { insights, snapshots, connectors };
        }
      );

      // Verify tenant 2 sees nothing
      expect(tenant2Results.insights).toHaveLength(0);
      expect(tenant2Results.snapshots).toHaveLength(0);
      expect(tenant2Results.connectors).toHaveLength(0);
    });
  });
});
