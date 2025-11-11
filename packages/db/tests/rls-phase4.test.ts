import { describe, it, expect } from 'vitest';
import { withTenantContext } from '../src/index';
import {
  testPrisma,
  TENANT_1_ID,
  TENANT_2_ID,
  USER_1_ID,
  USER_2_ID,
  createTestActionApproval,
  createTestNotification,
  createTestBoardActionItem,
  createTestBoardMeeting,
} from './setup';

/**
 * Phase 4 RLS Tests
 *
 * Validates Row-Level Security enforcement for:
 * - ActionApproval
 * - Notification
 */
describe('Phase 4: Row Level Security (RLS) Policies', () => {
  describe('ActionApproval RLS Policies', () => {
    it('should only return approvals for the active tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);
      const tenant2Meeting = await createTestBoardMeeting(TENANT_2_ID);

      const tenant1ActionItem = await createTestBoardActionItem(TENANT_1_ID, tenant1Meeting.id, {
        title: 'Tenant 1 approval',
      });

      await createTestActionApproval(TENANT_1_ID, {
        actionItemId: tenant1ActionItem.id,
        createdBy: USER_1_ID,
        auditLog: [{ event: 'submitted', by: USER_1_ID }],
      });

      await createTestActionApproval(TENANT_1_ID, {
        source: 'module:crm-sync',
        createdBy: USER_1_ID,
      });

      await createTestActionApproval(TENANT_2_ID, {
        createdBy: USER_2_ID,
        auditLog: [{ event: 'submitted', by: USER_2_ID }],
        actionItemId: (
          await createTestBoardActionItem(TENANT_2_ID, tenant2Meeting.id, {
            title: 'Tenant 2 action',
          })
        ).id,
      });

      const tenant1Approvals = await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        return tx.actionApproval.findMany({ orderBy: { createdAt: 'asc' } });
      });

      expect(tenant1Approvals).toHaveLength(2);
      tenant1Approvals.forEach((approval) => {
        expect(approval.tenantId).toBe(TENANT_1_ID);
      });

      const tenant2Approvals = await withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
        return tx.actionApproval.findMany();
      });

      expect(tenant2Approvals).toHaveLength(1);
      tenant2Approvals.forEach((approval) => {
        expect(approval.tenantId).toBe(TENANT_2_ID);
      });
    });

    it('should prevent inserting approvals for another tenant', async () => {
      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.actionApproval.create({
            data: {
              tenantId: TENANT_2_ID,
              source: 'board-orchestrator',
              payload: { attempt: 'cross-tenant' },
              riskScore: 10,
              status: 'pending',
              createdBy: USER_1_ID,
              auditLog: [{ event: 'submitted' }],
            },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent updating approvals belonging to another tenant', async () => {
      const approval = await createTestActionApproval(TENANT_1_ID, {
        createdBy: USER_1_ID,
      });

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.actionApproval.update({
            where: { id: approval.id },
            data: { status: 'approved', approvedBy: USER_2_ID },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent deleting approvals belonging to another tenant', async () => {
      const approval = await createTestActionApproval(TENANT_1_ID, {
        createdBy: USER_1_ID,
      });

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.actionApproval.delete({
            where: { id: approval.id },
          });
        })
      ).rejects.toThrow();
    });
  });

  describe('Notification RLS Policies', () => {
    it('should only return notifications for the active tenant', async () => {
      await createTestNotification(TENANT_1_ID, USER_1_ID, {
        type: 'approval_requested',
        payload: { message: 'Tenant 1 - Approval needed' },
      });

      await createTestNotification(TENANT_1_ID, USER_1_ID, {
        type: 'execution_complete',
        payload: { message: 'Tenant 1 - Task complete' },
      });

      await createTestNotification(TENANT_2_ID, USER_2_ID, {
        type: 'approval_requested',
        payload: { message: 'Tenant 2 - Approval needed' },
      });

      const tenant1Notifications = await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        return tx.notification.findMany({ orderBy: { createdAt: 'asc' } });
      });

      expect(tenant1Notifications).toHaveLength(2);
      tenant1Notifications.forEach((notification) => {
        expect(notification.tenantId).toBe(TENANT_1_ID);
      });

      const tenant2Notifications = await withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
        return tx.notification.findMany();
      });

      expect(tenant2Notifications).toHaveLength(1);
      tenant2Notifications.forEach((notification) => {
        expect(notification.tenantId).toBe(TENANT_2_ID);
      });
    });

    it('should prevent inserting notifications for another tenant', async () => {
      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.notification.create({
            data: {
              tenantId: TENANT_2_ID,
              userId: USER_2_ID,
              type: 'approval_requested',
              payload: { message: 'Cross-tenant attempt' },
            },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent updating notifications belonging to another tenant', async () => {
      const notification = await createTestNotification(TENANT_1_ID, USER_1_ID, {
        payload: { message: 'Awaiting read' },
      });

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.notification.update({
            where: { id: notification.id },
            data: { readAt: new Date() },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent deleting notifications belonging to another tenant', async () => {
      const notification = await createTestNotification(TENANT_1_ID, USER_1_ID);

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.notification.delete({
            where: { id: notification.id },
          });
        })
      ).rejects.toThrow();
    });
  });
});
