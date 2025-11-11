import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createTenantClient,
  TenantContextError,
  applyMiddlewares,
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
  createTestKnowledgeEntry,
  createTestKnowledgeSource,
} from './setup';

describe('Tenant Isolation Middleware', () => {
  describe('Basic Tenant Isolation', () => {
    it('should create records with tenantId automatically injected', async () => {
      const client = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      const conversation = await client.conversation.create({
        data: {
          userId: USER_1_ID,
          personaType: 'ceo',
          title: 'Test Conversation',
        },
      });

      expect(conversation.tenantId).toBe(TENANT_1_ID);

      await client.$disconnect();
    });

    it('should only find records from the current tenant', async () => {
      // Create conversations for both tenants
      await createTestConversation(TENANT_1_ID, USER_1_ID, 'ceo', 'Tenant 1 Conv');
      await createTestConversation(TENANT_2_ID, USER_2_ID, 'cfo', 'Tenant 2 Conv');

      // Query as tenant 1
      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });
      const conversations1 = await client1.conversation.findMany();

      expect(conversations1).toHaveLength(1);
      expect(conversations1[0].tenantId).toBe(TENANT_1_ID);

      // Query as tenant 2
      const client2 = createTenantClient({
        tenantId: TENANT_2_ID,
        userId: USER_2_ID,
      });
      const conversations2 = await client2.conversation.findMany();

      expect(conversations2).toHaveLength(1);
      expect(conversations2[0].tenantId).toBe(TENANT_2_ID);

      await client1.$disconnect();
      await client2.$disconnect();
    });

    it('should prevent cross-tenant data access with findUnique', async () => {
      // Create a conversation for tenant 1
      const conv = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'ceo',
        'Private Conversation'
      );

      // Try to access it as tenant 2
      const client2 = createTenantClient({
        tenantId: TENANT_2_ID,
        userId: USER_2_ID,
      });

      const result = await client2.conversation.findUnique({
        where: { id: conv.id },
      });

      // Should not find the record because middleware enforces tenant isolation
      expect(result).toBeNull();

      await client2.$disconnect();
    });

    it('should isolate updates to the current tenant only', async () => {
      // Create conversations for both tenants
      const conv1 = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'ceo',
        'Original Title 1'
      );
      const conv2 = await createTestConversation(
        TENANT_2_ID,
        USER_2_ID,
        'cfo',
        'Original Title 2'
      );

      // Update as tenant 1
      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      await client1.conversation.update({
        where: { id: conv1.id },
        data: { title: 'Updated Title 1' },
      });

      // Verify tenant 1's conversation was updated
      const updatedConv1 = await testPrisma.conversation.findUnique({
        where: { id: conv1.id },
      });
      expect(updatedConv1?.title).toBe('Updated Title 1');

      // Verify tenant 2's conversation was not affected
      const unchangedConv2 = await testPrisma.conversation.findUnique({
        where: { id: conv2.id },
      });
      expect(unchangedConv2?.title).toBe('Original Title 2');

      await client1.$disconnect();
    });

    it('should isolate deletes to the current tenant only', async () => {
      // Create tasks for both tenants
      const task1 = await createTestTask(TENANT_1_ID, USER_1_ID, 'test-task');
      const task2 = await createTestTask(TENANT_2_ID, USER_2_ID, 'test-task');

      // Delete as tenant 1
      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      await client1.task.delete({
        where: { id: task1.id },
      });

      // Verify tenant 1's task was deleted
      const deletedTask1 = await testPrisma.task.findUnique({
        where: { id: task1.id },
      });
      expect(deletedTask1).toBeNull();

      // Verify tenant 2's task still exists
      const existingTask2 = await testPrisma.task.findUnique({
        where: { id: task2.id },
      });
      expect(existingTask2).not.toBeNull();

      await client1.$disconnect();
    });
  });

  describe('Context Validation', () => {
    it('should throw error when tenantId is missing', () => {
      expect(() => {
        createTenantClient({
          tenantId: '',
          userId: USER_1_ID,
        });
      }).not.toThrow(); // Creation doesn't throw

      // But queries should throw
      const client = createTenantClient({
        tenantId: '',
        userId: USER_1_ID,
      });

      expect(
        client.conversation.findMany()
      ).rejects.toThrow(TenantContextError);

      client.$disconnect();
    });

    it('should allow global model access without tenant context', async () => {
      const client = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      // User and Tenant models should be accessible
      const users = await client.user.findMany();
      const tenants = await client.tenant.findMany();

      expect(users).toBeDefined();
      expect(tenants).toBeDefined();

      await client.$disconnect();
    });
  });

  describe('Complex Query Scenarios', () => {
    it('should enforce tenant isolation with nested queries', async () => {
      // Create conversation with messages for tenant 1
      const conv1 = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'ceo',
        'Tenant 1 Conv'
      );
      await createTestMessage(conv1.id, TENANT_1_ID, 'Message 1');
      await createTestMessage(conv1.id, TENANT_1_ID, 'Message 2');

      // Create conversation for tenant 2
      const conv2 = await createTestConversation(
        TENANT_2_ID,
        USER_2_ID,
        'cfo',
        'Tenant 2 Conv'
      );
      await createTestMessage(conv2.id, TENANT_2_ID, 'Message 3');

      // Query as tenant 1 with nested messages
      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      const conversations = await client1.conversation.findMany({
        include: { messages: true },
      });

      expect(conversations).toHaveLength(1);
      expect(conversations[0].messages).toHaveLength(2);
      expect(conversations[0].tenantId).toBe(TENANT_1_ID);

      await client1.$disconnect();
    });

    it('should handle where clauses with tenant isolation', async () => {
      // Create multiple tasks for tenant 1
      await createTestTask(TENANT_1_ID, USER_1_ID, 'task-1', 'pending');
      await createTestTask(TENANT_1_ID, USER_1_ID, 'task-2', 'completed');
      await createTestTask(TENANT_1_ID, USER_1_ID, 'task-3', 'pending');

      // Create tasks for tenant 2
      await createTestTask(TENANT_2_ID, USER_2_ID, 'task-4', 'pending');
      await createTestTask(TENANT_2_ID, USER_2_ID, 'task-5', 'completed');

      // Query tenant 1's pending tasks
      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      const pendingTasks = await client1.task.findMany({
        where: { status: 'pending' },
      });

      expect(pendingTasks).toHaveLength(2);
      pendingTasks.forEach((task) => {
        expect(task.tenantId).toBe(TENANT_1_ID);
        expect(task.status).toBe('pending');
      });

      await client1.$disconnect();
    });

    it('should handle orderBy and pagination with tenant isolation', async () => {
      // Create conversations with different timestamps
      const conv1 = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'ceo',
        'Conv A'
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const conv2 = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'cfo',
        'Conv B'
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const conv3 = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'cmo',
        'Conv C'
      );

      // Create conversation for tenant 2 (should not appear)
      await createTestConversation(TENANT_2_ID, USER_2_ID, 'cto', 'Conv D');

      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      // Get latest 2 conversations
      const conversations = await client1.conversation.findMany({
        orderBy: { createdAt: 'desc' },
        take: 2,
      });

      expect(conversations).toHaveLength(2);
      expect(conversations[0].title).toBe('Conv C');
      expect(conversations[1].title).toBe('Conv B');

      await client1.$disconnect();
    });
  });

  describe('Knowledge Entry Special Cases', () => {
    it('should allow creating company-wide knowledge entries', async () => {
      const client = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      // Create company-wide entry (tenantId: null)
      const companyEntry = await client.knowledgeEntry.create({
        data: {
          tenantId: null,
          source: 'company-docs',
          content: 'Company-wide knowledge',
        },
      });

      expect(companyEntry.tenantId).toBeNull();

      await client.$disconnect();
    });

    it('should allow querying both tenant-specific and company-wide knowledge', async () => {
      // Create tenant-specific entry
      await createTestKnowledgeEntry(
        TENANT_1_ID,
        'tenant-docs',
        'Tenant-specific knowledge'
      );

      // Create company-wide entry
      await createTestKnowledgeEntry(
        null,
        'company-docs',
        'Company-wide knowledge'
      );

      // Create entry for another tenant
      await createTestKnowledgeEntry(
        TENANT_2_ID,
        'other-docs',
        'Other tenant knowledge'
      );

      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      const entries = await client1.knowledgeEntry.findMany();

      // Should find tenant 1's entry and company-wide entry, but not tenant 2's
      expect(entries).toHaveLength(2);
      const tenantIds = entries.map((e) => e.tenantId);
      expect(tenantIds).toContain(TENANT_1_ID);
      expect(tenantIds).toContain(null);
      expect(tenantIds).not.toContain(TENANT_2_ID);

      await client1.$disconnect();
    });
  });

  describe('Knowledge Source Special Cases', () => {
    it('should allow creating company HQ knowledge sources', async () => {
      const client = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      const source = await client.knowledgeSource.create({
        data: {
          tenantId: null,
          name: 'HQ Handbook',
          type: 'hq_share',
          provider: 'hq',
        },
      });

      expect(source.tenantId).toBeNull();

      await client.$disconnect();
    });

    it('should scope knowledge sources to tenant plus HQ', async () => {
      await createTestKnowledgeSource(TENANT_1_ID, 'Tenant Source');
      await createTestKnowledgeSource(null, 'HQ Source', 'hq_share', 'hq');
      await createTestKnowledgeSource(TENANT_2_ID, 'Other Tenant Source');

      const client = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      const sources = await client.knowledgeSource.findMany();

      const tenantIds = sources.map((s) => s.tenantId);
      expect(tenantIds).toContain(TENANT_1_ID);
      expect(tenantIds).toContain(null);
      expect(tenantIds).not.toContain(TENANT_2_ID);

      await client.$disconnect();
    });
  });

  describe('Upsert Operations', () => {
    it('should enforce tenant isolation on upsert operations', async () => {
      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      // Create a connector
      const connector = await createTestConnector(TENANT_1_ID, 'google');

      // Upsert should update existing record
      const updated = await client1.connector.upsert({
        where: {
          tenantId_provider: {
            tenantId: TENANT_1_ID,
            provider: 'google',
          },
        },
        update: {
          status: 'error',
        },
        create: {
          provider: 'google',
          status: 'active',
          encryptedAccessToken: 'new-token',
          scopes: ['read'],
        },
      });

      expect(updated.id).toBe(connector.id);
      expect(updated.status).toBe('error');

      await client1.$disconnect();
    });
  });

  describe('Aggregate and Count Operations', () => {
    it('should only count records from current tenant', async () => {
      // Create tasks for tenant 1
      await createTestTask(TENANT_1_ID, USER_1_ID, 'task-1');
      await createTestTask(TENANT_1_ID, USER_1_ID, 'task-2');
      await createTestTask(TENANT_1_ID, USER_1_ID, 'task-3');

      // Create tasks for tenant 2
      await createTestTask(TENANT_2_ID, USER_2_ID, 'task-4');
      await createTestTask(TENANT_2_ID, USER_2_ID, 'task-5');

      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      const count = await client1.task.count();
      expect(count).toBe(3);

      await client1.$disconnect();
    });
  });

  describe('Relation Operations', () => {
    it('should enforce tenant isolation on relation queries', async () => {
      // Create conversation and messages for tenant 1
      const conv1 = await createTestConversation(
        TENANT_1_ID,
        USER_1_ID,
        'ceo',
        'Tenant 1 Conv'
      );
      await createTestMessage(conv1.id, TENANT_1_ID, 'Message 1');

      const client1 = createTenantClient({
        tenantId: TENANT_1_ID,
        userId: USER_1_ID,
      });

      // Query conversation with messages
      const conversation = await client1.conversation.findUnique({
        where: { id: conv1.id },
        include: { messages: true },
      });

      expect(conversation).not.toBeNull();
      expect(conversation!.messages).toHaveLength(1);

      await client1.$disconnect();
    });
  });
});
