import { Router as createRouter } from 'express';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenant.js';
import { apiLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import {
  installWidgetForTenant,
  listWidgetsForTenant,
  registerWidget,
  uninstallWidgetForTenant,
  WidgetNotFoundError,
} from '../services/marketplace.js';
import { normalizeWidgetRegistration } from '@ocsuite/module-sdk';

const router: Router = createRouter();

const installRequestSchema = z.object({
  settings: z.record(z.unknown()).optional(),
});

function isInternalAdmin(req: Request): boolean {
  const expectedKey = config.internalAdminApiKey?.trim();
  if (!expectedKey) {
    return false;
  }

  const candidate = req.header('x-internal-api-key') ?? req.header('x-internal-key');
  return typeof candidate === 'string' && candidate.trim() === expectedKey;
}

router.get(
  '/widgets',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;

    try {
      const widgets = await listWidgetsForTenant(tenantId);
      return res.status(200).json({ widgets });
    } catch (error) {
      apiLogger.error('Failed to list marketplace widgets', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to load marketplace widgets',
      });
    }
  }
);

router.post('/widgets', async (req: Request, res: Response) => {
  if (!isInternalAdmin(req)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Internal admin key required to register widgets',
    });
  }

  try {
    const registration = normalizeWidgetRegistration(req.body);
    const result = await registerWidget(registration);

    return res.status(result.created ? 201 : 200).json({
      widget: result.widget,
      created: result.created,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid widget registration payload',
        details: error.flatten(),
      });
    }

    apiLogger.error('Failed to register marketplace widget', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      error: 'internal_error',
      message: 'Failed to register marketplace widget',
    });
  }
});

router.post(
  '/widgets/:slug/install',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const clerkId = req.clerkId;
    const { slug } = req.params as { slug?: string };

    if (!slug) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Widget slug is required',
      });
    }

    const parse = installRequestSchema.safeParse(req.body ?? {});

    if (!parse.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid install payload',
        details: parse.error.flatten(),
      });
    }

    try {
      const widget = await installWidgetForTenant({
        tenantId,
        widgetSlug: slug,
        settings: parse.data.settings,
        clerkId,
      });

      return res.status(200).json({ widget });
    } catch (error) {
      if (error instanceof WidgetNotFoundError) {
        return res.status(404).json({
          error: 'not_found',
          message: error.message,
        });
      }

      apiLogger.error('Failed to install widget for tenant', {
        tenantId,
        widgetSlug: slug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to install widget',
      });
    }
  }
);

router.delete(
  '/widgets/:slug/install',
  requireAuth(),
  resolveTenant(),
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    const clerkId = req.clerkId;
    const { slug } = req.params as { slug?: string };

    if (!slug) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Widget slug is required',
      });
    }

    try {
      await uninstallWidgetForTenant({
        tenantId,
        widgetSlug: slug,
        clerkId,
      });

      return res.status(204).send();
    } catch (error) {
      if (error instanceof WidgetNotFoundError) {
        return res.status(404).json({
          error: 'not_found',
          message: error.message,
        });
      }

      apiLogger.error('Failed to uninstall widget for tenant', {
        tenantId,
        widgetSlug: slug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'internal_error',
        message: 'Failed to uninstall widget',
      });
    }
  }
);

export default router;
