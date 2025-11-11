import { describe, it, expect } from 'vitest';
import { withTenantContext } from '../src/index';
import {
  testPrisma,
  TENANT_1_ID,
  TENANT_2_ID,
  createTestKnowledgeSource,
  createTestKnowledgeEntry,
} from './setup';

/**
 * Phase 5 RLS Tests
 *
 * Validates Row-Level Security enforcement for:
 * - KnowledgeSource
 * - KnowledgeEntry
 */
describe('Phase 5: Row Level Security (RLS) Policies', () => {
  describe('KnowledgeSource RLS Policies', () => {
    it('should only return sources for the active tenant', async () => {
      await createTestKnowledgeSource(TENANT_1_ID, 'Tenant 1 Source A');
      await createTestKnowledgeSource(TENANT_1_ID, 'Tenant 1 Source B');
      await createTestKnowledgeSource(TENANT_2_ID, 'Tenant 2 Source');

      const tenant1Sources = await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        return tx.knowledgeSource.findMany({ orderBy: { createdAt: 'asc' } });
      });

      expect(tenant1Sources).toHaveLength(2);
      tenant1Sources.forEach((source) => {
        expect(source.tenantId).toBe(TENANT_1_ID);
      });

      const tenant2Sources = await withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
        return tx.knowledgeSource.findMany();
      });

      expect(tenant2Sources).toHaveLength(1);
      tenant2Sources.forEach((source) => {
        expect(source.tenantId).toBe(TENANT_2_ID);
      });
    });

    it('should prevent inserting sources for another tenant', async () => {
      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.knowledgeSource.create({
            data: {
              tenantId: TENANT_2_ID,
              name: 'Cross Tenant Attempt',
              type: 'manual_note',
              provider: 'manual',
              status: 'ready',
            },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent updating sources belonging to another tenant', async () => {
      const tenant1Source = await createTestKnowledgeSource(TENANT_1_ID, 'Tenant 1 Source');

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.knowledgeSource.update({
            where: { id: tenant1Source.id },
            data: { name: 'Illegal Update' },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent deleting sources belonging to another tenant', async () => {
      const tenant1Source = await createTestKnowledgeSource(TENANT_1_ID, 'Tenant 1 Source');

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.knowledgeSource.delete({
            where: { id: tenant1Source.id },
          });
        })
      ).rejects.toThrow();
    });
  });

  describe('KnowledgeEntry RLS Policies', () => {
    it('should only return entries for the active tenant', async () => {
      const tenant1Source = await createTestKnowledgeSource(TENANT_1_ID, 'Tenant 1 Source');
      const tenant2Source = await createTestKnowledgeSource(TENANT_2_ID, 'Tenant 2 Source');

      await createTestKnowledgeEntry(TENANT_1_ID, 'seed:tenant-1', 'Tenant 1 Entry 1', tenant1Source.id);
      await createTestKnowledgeEntry(TENANT_1_ID, 'seed:tenant-1', 'Tenant 1 Entry 2', tenant1Source.id);
      await createTestKnowledgeEntry(TENANT_2_ID, 'seed:tenant-2', 'Tenant 2 Entry', tenant2Source.id);

      const tenant1Entries = await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        return tx.knowledgeEntry.findMany({ orderBy: { createdAt: 'asc' } });
      });

      expect(tenant1Entries).toHaveLength(2);
      tenant1Entries.forEach((entry) => {
        expect(entry.tenantId).toBe(TENANT_1_ID);
      });

      const tenant2Entries = await withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
        return tx.knowledgeEntry.findMany();
      });

      expect(tenant2Entries).toHaveLength(1);
      tenant2Entries.forEach((entry) => {
        expect(entry.tenantId).toBe(TENANT_2_ID);
      });
    });

    it('should prevent inserting entries for another tenant', async () => {
      const tenant1Source = await createTestKnowledgeSource(TENANT_1_ID, 'Tenant 1 Source');

      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.knowledgeEntry.create({
            data: {
              tenantId: TENANT_2_ID,
              source: 'seed:illegal',
              sourceId: tenant1Source.id,
              content: 'Cross tenant entry attempt',
            },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent updating entries belonging to another tenant', async () => {
      const tenant1Source = await createTestKnowledgeSource(TENANT_1_ID, 'Tenant 1 Source');
      const tenant1Entry = await createTestKnowledgeEntry(
        TENANT_1_ID,
        'seed:tenant-1',
        'Tenant 1 Entry',
        tenant1Source.id
      );

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.knowledgeEntry.update({
            where: { id: tenant1Entry.id },
            data: { content: 'Illegal Update' },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent deleting entries belonging to another tenant', async () => {
      const tenant1Source = await createTestKnowledgeSource(TENANT_1_ID, 'Tenant 1 Source');
      const tenant1Entry = await createTestKnowledgeEntry(
        TENANT_1_ID,
        'seed:tenant-1',
        'Tenant 1 Entry',
        tenant1Source.id
      );

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.knowledgeEntry.delete({
            where: { id: tenant1Entry.id },
          });
        })
      ).rejects.toThrow();
    });
  });
});
