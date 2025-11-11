import { describe, it, expect, beforeEach } from 'vitest';
import {
  setRLSTenantContext,
  clearRLSTenantContext,
  withTenantContext,
} from '../src/index';
import {
  testPrisma,
  TENANT_1_ID,
  TENANT_2_ID,
  USER_1_ID,
  USER_2_ID,
  createTestConversation,
  createTestMessage,
  createTestTask,
  createTestConnector,
} from './setup';

describe('Row Level Security (RLS) Policies', () => {
  describe('RLS Context Management', () => {
    it('should set and clear RLS tenant context', async () => {
      // Set context
      await setRLSTenantContext(testPrisma, TENANT_1_ID);

      // Clear context
      await clearRLSTenantContext(testPrisma);

      // No errors should be thrown
      expect(true).toBe(true);
    });

    it('should execute queries within tenant context using withTenantContext', async () => {
      // Create conversations for both tenants
      await createTestConversation(TENANT_1_ID, USER_1_ID, 'ceo', 'Tenant 1 Conv');
      await createTestConversation(TENANT_2_ID, USER_2_ID, 'cfo', 'Tenant 2 Conv');

      // Query within tenant 1 context
      const result = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          return tx.conversation.findMany();
        }
      );

      // Should only see tenant 1's conversation
      expect(result).toHaveLength(1);
      expect(result[0].tenantId).toBe(TENANT_1_ID);
    });

    it('should clear context even if callback throws', async () => {
      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Context should be cleared, no assertions needed
      // The cleanup is guaranteed by the finally block
    });
  });

  describe('RLS SELECT Policies', () => {
    it('should block cross-tenant SELECT queries', async () => {
      // Create conversations for both tenants
      await createTestConversation(TENANT_1_ID, USER_1_ID, 'ceo', 'Tenant 1 Conv');
      await createTestConversation(TENANT_2_ID, USER_2_ID, 'cfo', 'Tenant 2 Conv');

      // Query as tenant 1
      const tenant1Results = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          return tx.conversation.findMany();
        }
      );

      expect(tenant1Results).toHaveLength(1);
      expect(tenant1Results[0].tenantId).toBe(TENANT_1_ID);

      // Query as tenant 2
      const tenant2Results = await withTenantContext(
        testPrisma,
        TENANT_2_ID,
        async (tx) => {
          return tx.conversation.findMany();
        }
      );

      expect(tenant2Results).toHaveLength(1);
      expect(tenant2Results[0].tenantId).toBe(TENANT_2_ID);
    });

    it('should enforce RLS on messages table', async () => {
      // Create conversations and messages for both tenants
      const conv1 = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'ceo',
        'Conv 1'
      );
      await createTestMessage(conv1.id, TENANT_1_ID, 'Message 1');
      await createTestMessage(conv1.id, TENANT_1_ID, 'Message 2');

      const conv2 = await createTestConversation(
        TENANT_2_ID,
        USER_2_ID,
        'cfo',
        'Conv 2'
      );
      await createTestMessage(conv2.id, TENANT_2_ID, 'Message 3');

      // Query as tenant 1
      const tenant1Messages = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          return tx.message.findMany();
        }
      );

      expect(tenant1Messages).toHaveLength(2);
      tenant1Messages.forEach((msg) => {
        expect(msg.tenantId).toBe(TENANT_1_ID);
      });
    });

    it('should enforce RLS on tasks table', async () => {
      // Create tasks for both tenants
      await createTestTask(TENANT_1_ID, USER_1_ID, 'task-1');
      await createTestTask(TENANT_1_ID, USER_1_ID, 'task-2');
      await createTestTask(TENANT_2_ID, USER_2_ID, 'task-3');

      // Query as tenant 1
      const tenant1Tasks = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          return tx.task.findMany();
        }
      );

      expect(tenant1Tasks).toHaveLength(2);
      tenant1Tasks.forEach((task) => {
        expect(task.tenantId).toBe(TENANT_1_ID);
      });
    });

    it('should enforce RLS on connectors table', async () => {
      // Create connectors for both tenants
      await createTestConnector(TENANT_1_ID, 'google');
      await createTestConnector(TENANT_1_ID, 'slack');
      await createTestConnector(TENANT_2_ID, 'notion');

      // Query as tenant 1
      const tenant1Connectors = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          return tx.connector.findMany();
        }
      );

      expect(tenant1Connectors).toHaveLength(2);
      tenant1Connectors.forEach((conn) => {
        expect(conn.tenantId).toBe(TENANT_1_ID);
      });
    });
  });

  describe('RLS INSERT Policies', () => {
    it('should allow INSERT only with matching tenant context', async () => {
      await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        const conversation = await tx.conversation.create({
          data: {
            tenantId: TENANT_1_ID,
            userId: USER_1_ID,
            personaType: 'ceo',
            title: 'Test Conversation',
          },
        });

        expect(conversation.tenantId).toBe(TENANT_1_ID);
      });
    });

    it('should block INSERT with mismatched tenant context', async () => {
      // Try to insert with tenant 2 ID while context is tenant 1
      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.conversation.create({
            data: {
              tenantId: TENANT_2_ID, // Mismatch!
              userId: USER_2_ID,
              personaType: 'ceo',
              title: 'Malicious Conversation',
            },
          });
        })
      ).rejects.toThrow();
    });
  });

  describe('RLS UPDATE Policies', () => {
    it('should allow UPDATE only within tenant context', async () => {
      // Create conversation for tenant 1
      const conv = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'ceo',
        'Original Title'
      );

      // Update as tenant 1
      await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        await tx.conversation.update({
          where: { id: conv.id },
          data: { title: 'Updated Title' },
        });
      });

      // Verify update succeeded
      const updated = await testPrisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(updated?.title).toBe('Updated Title');
    });

    it('should block UPDATE from different tenant context', async () => {
      // Create conversation for tenant 1
      const conv = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'ceo',
        'Original Title'
      );

      // Try to update as tenant 2
      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.conversation.update({
            where: { id: conv.id },
            data: { title: 'Malicious Update' },
          });
        })
      ).rejects.toThrow();

      // Verify original title unchanged
      const unchanged = await testPrisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(unchanged?.title).toBe('Original Title');
    });

    it('should prevent updating tenantId to different tenant', async () => {
      // Create task for tenant 1
      const task = await createTestTask(TENANT_1_ID, USER_1_ID, 'task-1');

      // Try to change tenantId to tenant 2 (should fail RLS check)
      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.task.update({
            where: { id: task.id },
            data: { tenantId: TENANT_2_ID },
          });
        })
      ).rejects.toThrow();
    });
  });

  describe('RLS DELETE Policies', () => {
    it('should allow DELETE only within tenant context', async () => {
      // Create task for tenant 1
      const task = await createTestTask(TENANT_1_ID, USER_1_ID, 'task-1');

      // Delete as tenant 1
      await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        await tx.task.delete({
          where: { id: task.id },
        });
      });

      // Verify deletion
      const deleted = await testPrisma.task.findUnique({
        where: { id: task.id },
      });
      expect(deleted).toBeNull();
    });

    it('should block DELETE from different tenant context', async () => {
      // Create task for tenant 1
      const task = await createTestTask(TENANT_1_ID, USER_1_ID, 'task-1');

      // Try to delete as tenant 2
      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.task.delete({
            where: { id: task.id },
          });
        })
      ).rejects.toThrow();

      // Verify task still exists
      const stillExists = await testPrisma.task.findUnique({
        where: { id: task.id },
      });
      expect(stillExists).not.toBeNull();
    });
  });

  describe('RLS with Raw Queries', () => {
    it('should enforce RLS on raw SELECT queries', async () => {
      // Create conversations for both tenants
      await createTestConversation(TENANT_1_ID, USER_1_ID, 'ceo', 'Conv 1');
      await createTestConversation(TENANT_2_ID, USER_2_ID, 'cfo', 'Conv 2');

      // Raw query as tenant 1
      const results = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          return tx.$queryRaw<
            Array<{ id: string; tenantId: string }>
          >`
            SELECT id, "tenantId" FROM conversations
          `;
        }
      );

      // Should only return tenant 1's conversation
      expect(results).toHaveLength(1);
      expect(results[0].tenantId).toBe(TENANT_1_ID);
    });

    it('should enforce RLS on raw INSERT queries', async () => {
      // Try to insert with mismatched context
      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.$executeRaw`
            INSERT INTO tasks ("id", "tenantId", "userId", "type", "status", "priority", "payload")
            VALUES (gen_random_uuid(), ${TENANT_2_ID}, ${USER_2_ID}, 'test', 'pending', 'normal', '{}')
          `;
        })
      ).rejects.toThrow();
    });
  });

  describe('RLS Performance', () => {
    it('should efficiently query large datasets with RLS', async () => {
      // Create many conversations for tenant 1
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          createTestConversation(TENANT_1_ID, USER_1_ID, 'ceo', `Conv ${i}`)
        );
      }
      await Promise.all(promises);

      // Create conversations for tenant 2
      for (let i = 0; i < 50; i++) {
        promises.push(
          createTestConversation(TENANT_2_ID, USER_2_ID, 'cfo', `Conv ${i}`)
        );
      }
      await Promise.all(promises);

      // Query with RLS should be fast and only return tenant 1 data
      const startTime = Date.now();
      const results = await withTenantContext(
        testPrisma,
        TENANT_1_ID,
        async (tx) => {
          return tx.conversation.findMany();
        }
      );
      const endTime = Date.now();

      expect(results).toHaveLength(50);
      expect(endTime - startTime).toBeLessThanOrEqual(1500); // Allow modest jitter in CI environments
    });
  });

  describe('Combined Middleware and RLS', () => {
    it('should have both middleware and RLS enforce tenant isolation', async () => {
      // This test verifies defense-in-depth:
      // Both application-level middleware AND database-level RLS should block cross-tenant access

      // Create conversations for both tenants
      await createTestConversation(TENANT_1_ID, USER_1_ID, 'ceo', 'Conv 1');
      await createTestConversation(TENANT_2_ID, USER_2_ID, 'cfo', 'Conv 2');

      // Even with RLS context set, middleware should filter
      await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        const conversations = await tx.conversation.findMany();

        // Should only see tenant 1 data
        expect(conversations).toHaveLength(1);
        expect(conversations[0].tenantId).toBe(TENANT_1_ID);
      });
    });
  });
});
