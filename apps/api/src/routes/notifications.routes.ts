import { Router as createRouter } from 'express';
import type { Router } from 'express';
import { z } from 'zod';
import { createTenantClient } from '@ocsuite/db';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { apiLogger } from '../utils/logger.js';

const router: Router = createRouter();

const CHANNELS = ['in_app', 'email', 'slack_stub'] as const;

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(),
  channel: z.enum(CHANNELS).optional(),
  unread: z.coerce.boolean().optional(),
});

const preferenceUpdateSchema = z.object({
  channel: z.enum(CHANNELS),
  enabled: z.boolean(),
});

router.get(
  '/stats',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;
    const db = createTenantClient({ tenantId, userId: clerkId });

    try {
      const user = await db.user.findFirst({
        where: { clerkId },
        select: { id: true },
      });

      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found',
        });
      }

      const baseWhere = {
        tenantId,
        userId: user.id,
      } as const;

      const [total, unread, latest] = await Promise.all([
        db.notification.count({ where: baseWhere }),
        db.notification.count({
          where: {
            ...baseWhere,
            readAt: null,
          },
        }),
        db.notification.findFirst({
          where: baseWhere,
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true, readAt: true },
        }),
      ]);

      return res.status(200).json({
        total,
        unread,
        latest: latest ?? null,
      });
    } catch (error) {
      apiLogger.error('Failed to fetch notification stats', {
        tenantId,
        clerkId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to fetch notification stats',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.get(
  '/',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const parse = listQuerySchema.safeParse(req.query ?? {});

    if (!parse.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid query parameters',
        details: parse.error.format(),
      });
    }

    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;
    const db = createTenantClient({ tenantId, userId: clerkId });

    try {
      const { limit = 20, cursor, channel, unread } = parse.data;

      const notifications = await db.notification.findMany({
        where: {
          user: {
            clerkId,
          },
          channel,
          readAt: unread === true ? null : undefined,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        ...(cursor
          ? {
              skip: 1,
              cursor: { id: cursor },
            }
          : {}),
      });

      return res.status(200).json({
        notifications,
        nextCursor: notifications.length === limit ? notifications.at(-1)?.id : undefined,
      });
    } catch (error) {
      apiLogger.error('Failed to list notifications', {
        tenantId,
        clerkId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to list notifications',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.post(
  '/:id/read',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const { id } = req.params as { id?: string };

    if (!id) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Notification ID is required',
      });
    }

    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;
    const db = createTenantClient({ tenantId, userId: clerkId });

    try {
      const notification = await db.notification.findFirst({
        where: {
          id,
          user: {
            clerkId,
          },
        },
      });

      if (!notification) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Notification not found',
        });
      }

      const updated = await db.notification.update({
        where: { id },
        data: {
          readAt: new Date(),
        },
      });

      return res.status(200).json({
        notification: updated,
      });
    } catch (error) {
      apiLogger.error('Failed to mark notification as read', {
        tenantId,
        clerkId,
        notificationId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to update notification',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.post(
  '/read-all',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;
    const db = createTenantClient({ tenantId, userId: clerkId });

    try {
      const result = await db.notification.updateMany({
        where: {
          user: {
            clerkId,
          },
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      });

      return res.status(200).json({
        updated: result.count,
      });
    } catch (error) {
      apiLogger.error('Failed to mark notifications as read', {
        tenantId,
        clerkId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to update notifications',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.get(
  '/preferences',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;
    const db = createTenantClient({ tenantId, userId: clerkId });

    try {
      const user = await db.user.findFirst({
        where: { clerkId },
        select: { id: true },
      });

      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found',
        });
      }

      const preferences = await db.notificationPreference.findMany({
        where: { userId: user.id },
      });

      const preferenceMap = new Map<string, boolean>(
        preferences.map((preference: (typeof preferences)[number]) => [preference.channel, preference.enabled])
      );

      const response = CHANNELS.map((channel) => ({
        channel,
        enabled: preferenceMap.has(channel)
          ? preferenceMap.get(channel)!
          : channel === 'in_app',
      }));

      return res.status(200).json({ preferences: response });
    } catch (error) {
      apiLogger.error('Failed to fetch notification preferences', {
        tenantId,
        clerkId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to load notification preferences',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

router.post(
  '/preferences',
  requireAuth(),
  resolveTenant(),
  async (req, res) => {
    const parse = preferenceUpdateSchema.safeParse(req.body ?? {});

    if (!parse.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid preference payload',
        details: parse.error.format(),
      });
    }

    const tenantId = req.tenantId!;
    const clerkId = req.clerkId!;
    const db = createTenantClient({ tenantId, userId: clerkId });

    try {
      const user = await db.user.findFirst({
        where: { clerkId },
        select: { id: true },
      });

      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found',
        });
      }

      const preference = await db.notificationPreference.upsert({
        where: {
          tenantId_userId_channel: {
            tenantId,
            userId: user.id,
            channel: parse.data.channel,
          },
        },
        update: {
          enabled: parse.data.enabled,
        },
        create: {
          tenantId,
          userId: user.id,
          channel: parse.data.channel,
          enabled: parse.data.enabled,
        },
      });

      return res.status(200).json({ preference });
    } catch (error) {
      apiLogger.error('Failed to update notification preference', {
        tenantId,
        clerkId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to update notification preference',
      });
    } finally {
      await db.$disconnect();
    }
  }
);

export default router;
