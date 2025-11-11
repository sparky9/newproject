import { describe, it, expect } from 'vitest';
import { withTenantContext } from '../src/index';
import {
  testPrisma,
  TENANT_1_ID,
  TENANT_2_ID,
  createTestBoardMeeting,
  createTestBoardPersonaTurn,
  createTestBoardActionItem,
} from './setup';

/**
 * Phase 3 RLS Tests
 *
 * Validates Row-Level Security policies for the new board meeting tables:
 * - BoardMeeting
 * - BoardPersonaTurn
 * - BoardActionItem
 */
describe('Phase 3: Row Level Security (RLS) Policies', () => {
  describe('BoardMeeting RLS Policies', () => {
    it('should only return meetings for the active tenant', async () => {
      await createTestBoardMeeting(TENANT_1_ID, { outcomeSummary: 'Tenant 1 Meeting A' });
      await createTestBoardMeeting(TENANT_1_ID, { outcomeSummary: 'Tenant 1 Meeting B' });
      await createTestBoardMeeting(TENANT_2_ID, { outcomeSummary: 'Tenant 2 Meeting' });

      const tenant1Meetings = await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        return tx.boardMeeting.findMany({ orderBy: { createdAt: 'asc' } });
      });

      expect(tenant1Meetings).toHaveLength(2);
      tenant1Meetings.forEach((meeting) => {
        expect(meeting.tenantId).toBe(TENANT_1_ID);
      });

      const tenant2Meetings = await withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
        return tx.boardMeeting.findMany();
      });

      expect(tenant2Meetings).toHaveLength(1);
      tenant2Meetings.forEach((meeting) => {
        expect(meeting.tenantId).toBe(TENANT_2_ID);
      });
    });

    it('should prevent inserting meetings for a different tenant', async () => {
      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.boardMeeting.create({
            data: {
              tenantId: TENANT_2_ID,
              agenda: { sections: ['Cross tenant attempt'] },
            },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent updating meetings that belong to another tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID, {
        outcomeSummary: 'Original summary',
      });

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.boardMeeting.update({
            where: { id: tenant1Meeting.id },
            data: { outcomeSummary: 'Tampered summary' },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent deleting meetings that belong to another tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.boardMeeting.delete({
            where: { id: tenant1Meeting.id },
          });
        })
      ).rejects.toThrow();
    });
  });

  describe('BoardPersonaTurn RLS Policies', () => {
    it('should only return persona turns for the active tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);
      const tenant2Meeting = await createTestBoardMeeting(TENANT_2_ID);

      await createTestBoardPersonaTurn(TENANT_1_ID, tenant1Meeting.id, {
        persona: 'ceo',
        role: 'ceo',
        sequence: 1,
        content: 'Tenant 1 CEO turn',
      });
      await createTestBoardPersonaTurn(TENANT_1_ID, tenant1Meeting.id, {
        persona: 'cfo',
        role: 'cfo',
        sequence: 2,
        content: 'Tenant 1 CFO turn',
      });
      await createTestBoardPersonaTurn(TENANT_2_ID, tenant2Meeting.id, {
        persona: 'cmo',
        role: 'cmo',
        sequence: 1,
        content: 'Tenant 2 CMO turn',
      });

      const tenant1Turns = await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        return tx.boardPersonaTurn.findMany({ orderBy: { sequence: 'asc' } });
      });

      expect(tenant1Turns).toHaveLength(2);
      tenant1Turns.forEach((turn) => {
        expect(turn.tenantId).toBe(TENANT_1_ID);
      });

      const tenant2Turns = await withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
        return tx.boardPersonaTurn.findMany();
      });

      expect(tenant2Turns).toHaveLength(1);
      tenant2Turns.forEach((turn) => {
        expect(turn.tenantId).toBe(TENANT_2_ID);
      });
    });

    it('should prevent inserting persona turns with mismatched tenant context', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);

      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.boardPersonaTurn.create({
            data: {
              tenantId: TENANT_2_ID,
              meetingId: tenant1Meeting.id,
              persona: 'cto',
              role: 'cto',
              sequence: 3,
              content: 'Invalid insert',
              streamedAt: new Date(),
            },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent updating persona turns that belong to another tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);
      const tenant1Turn = await createTestBoardPersonaTurn(TENANT_1_ID, tenant1Meeting.id, {
        persona: 'cto',
        role: 'cto',
        sequence: 4,
        content: 'Original content',
      });

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.boardPersonaTurn.update({
            where: { id: tenant1Turn.id },
            data: { content: 'Tampered content' },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent deleting persona turns that belong to another tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);
      const tenant1Turn = await createTestBoardPersonaTurn(TENANT_1_ID, tenant1Meeting.id, {
        persona: 'cmo',
        role: 'cmo',
        sequence: 5,
        content: 'Delete attempt',
      });

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.boardPersonaTurn.delete({
            where: { id: tenant1Turn.id },
          });
        })
      ).rejects.toThrow();
    });
  });

  describe('BoardActionItem RLS Policies', () => {
    it('should only return action items for the active tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);
      const tenant2Meeting = await createTestBoardMeeting(TENANT_2_ID);

      await createTestBoardActionItem(TENANT_1_ID, tenant1Meeting.id, {
        title: 'Tenant 1 Action 1',
      });
      await createTestBoardActionItem(TENANT_1_ID, tenant1Meeting.id, {
        title: 'Tenant 1 Action 2',
      });
      await createTestBoardActionItem(TENANT_2_ID, tenant2Meeting.id, {
        title: 'Tenant 2 Action',
      });

      const tenant1Items = await withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
        return tx.boardActionItem.findMany({ orderBy: { createdAt: 'asc' } });
      });

      expect(tenant1Items).toHaveLength(2);
      tenant1Items.forEach((item) => {
        expect(item.tenantId).toBe(TENANT_1_ID);
      });

      const tenant2Items = await withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
        return tx.boardActionItem.findMany();
      });

      expect(tenant2Items).toHaveLength(1);
      tenant2Items.forEach((item) => {
        expect(item.tenantId).toBe(TENANT_2_ID);
      });
    });

    it('should prevent inserting action items with mismatched tenant context', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);

      await expect(
        withTenantContext(testPrisma, TENANT_1_ID, async (tx) => {
          return tx.boardActionItem.create({
            data: {
              tenantId: TENANT_2_ID,
              meetingId: tenant1Meeting.id,
              title: 'Invalid action',
              status: 'open',
            },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent updating action items that belong to another tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);
      const tenant1Action = await createTestBoardActionItem(TENANT_1_ID, tenant1Meeting.id, {
        title: 'Original action',
      });

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.boardActionItem.update({
            where: { id: tenant1Action.id },
            data: { status: 'completed' },
          });
        })
      ).rejects.toThrow();
    });

    it('should prevent deleting action items that belong to another tenant', async () => {
      const tenant1Meeting = await createTestBoardMeeting(TENANT_1_ID);
      const tenant1Action = await createTestBoardActionItem(TENANT_1_ID, tenant1Meeting.id, {
        title: 'Delete attempt',
      });

      await expect(
        withTenantContext(testPrisma, TENANT_2_ID, async (tx) => {
          return tx.boardActionItem.delete({
            where: { id: tenant1Action.id },
          });
        })
      ).rejects.toThrow();
    });
  });
});
