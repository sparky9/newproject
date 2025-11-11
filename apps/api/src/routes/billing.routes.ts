import { Router as createRouter } from 'express';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { apiLogger } from '../utils/logger.js';
import { applyBillingUsageDelta, getBillingUsage, normalizeToDate } from '../services/billing.js';
import { config } from '../config/index.js';

const router: Router = createRouter();

const querySchema = z
  .object({
    days: z.coerce.number().int().positive().max(365).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (value) => {
      if (value.from && value.to) {
        return value.from.getTime() <= value.to.getTime();
      }
      return true;
    },
    {
      path: ['from'],
      message: '`from` date must be before `to` date',
    }
  );

router.get('/usage', requireAuth(), resolveTenant(), async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;

  const parse = querySchema.safeParse(req.query ?? {});

  if (!parse.success) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Invalid query parameters',
      details: parse.error.flatten(),
    });
  }

  const { days, from, to } = parse.data;

  const endDate = normalizeToDate(to ?? new Date());
  const startDate = normalizeToDate(
    from ?? new Date(endDate.getTime() - ((days ?? 30) - 1) * 24 * 60 * 60 * 1000)
  );

  try {
    const summary = await getBillingUsage({ tenantId, startDate, endDate });
    return res.status(200).json(summary);
  } catch (error) {
    apiLogger.error('Failed to load billing usage', {
      tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      error: 'internal_error',
      message: 'Failed to load billing usage',
    });
  }
});

const webhookSchema = z
  .object({
    type: z.string().min(1),
    id: z.string().optional(),
    created: z.number().optional(),
    data: z
      .object({
        tenantId: z.string().min(1).optional(),
        usage: z
          .object({
            tokensUsed: z.number().int().nonnegative().optional(),
            tasksExecuted: z.number().int().nonnegative().optional(),
            alertsTriggered: z.number().int().nonnegative().optional(),
            activeWidgets: z.number().int().nonnegative().optional(),
          })
          .optional(),
        metadata: z.record(z.unknown()).optional(),
        object: z.record(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function resolveTenantFromEvent(event: z.infer<typeof webhookSchema>): string | undefined {
  if (event.data?.tenantId) {
    return event.data.tenantId;
  }

  const object = event.data?.object;
  if (object && typeof object === 'object') {
    const metadata = (object as Record<string, unknown>)?.metadata;
    if (metadata && typeof metadata === 'object' && metadata !== null) {
      const tenantId = (metadata as Record<string, unknown>).tenantId;
      if (typeof tenantId === 'string' && tenantId.trim().length > 0) {
        return tenantId;
      }
    }
  }

  return undefined;
}

function toEventIso(created?: number): string | undefined {
  if (!created) {
    return undefined;
  }

  const date = new Date(created * 1000);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

router.post('/webhook', async (req: Request, res: Response) => {
  const expectedSignature = config.stripe.webhookSecret;
  if (expectedSignature) {
    const actualSignature = req.header('stripe-signature');
    if (!actualSignature || actualSignature !== expectedSignature) {
      apiLogger.warn('Rejected billing webhook due to signature mismatch', {
        expected: !!expectedSignature,
        provided: Boolean(actualSignature),
      });

      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid webhook signature',
      });
    }
  }

  const parse = webhookSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    apiLogger.warn('Received invalid billing webhook payload', {
      details: parse.error.flatten(),
    });

    return res.status(400).json({
      error: 'validation_error',
      message: 'Invalid webhook payload',
      details: parse.error.flatten(),
    });
  }

  const event = parse.data;
  const tenantId = resolveTenantFromEvent(event);

  if (!tenantId) {
    apiLogger.warn('Billing webhook missing tenant identifier', {
      eventType: event.type,
      eventId: event.id,
    });
    return res.status(202).json({ status: 'ignored' });
  }

  const usage = event.data?.usage ?? {};

  try {
    const point = await applyBillingUsageDelta({
      tenantId,
      deltas: {
        tokensUsed: usage.tokensUsed,
        tasksExecuted: usage.tasksExecuted,
        alertsTriggered: usage.alertsTriggered,
        activeWidgets: usage.activeWidgets,
      },
      event: {
        type: event.type,
        occurredAt: toEventIso(event.created),
        payload: event.data?.metadata,
      },
    });

    apiLogger.info('Processed billing webhook event', {
      tenantId,
      eventType: event.type,
      eventId: event.id,
      usage: point,
    });

    return res.status(202).json({ status: 'processed' });
  } catch (error) {
    apiLogger.error('Failed to process billing webhook', {
      tenantId,
      eventType: event.type,
      eventId: event.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      error: 'internal_error',
      message: 'Failed to process billing webhook',
    });
  }
});

export default router;
