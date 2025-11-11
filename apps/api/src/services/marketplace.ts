import { Prisma, createTenantClient, prisma, type TenantWidget, type Widget } from '@ocsuite/db';
import { WidgetRegistrationSchema, normalizeWidgetRegistration, type WidgetRegistration, type WidgetDashboardTile } from '@ocsuite/module-sdk';
import { z } from 'zod';
import { toInputJson, parseJsonRecord } from '../utils/json.js';

const StoredWidgetConfigSchema = z
  .object({
    dashboard: WidgetRegistrationSchema.shape.dashboard.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .partial();

type StoredWidgetConfig = z.infer<typeof StoredWidgetConfigSchema>;

type InstallRecord = Pick<TenantWidget, 'enabledAt' | 'settings'>;

export interface WidgetDto {
  slug: string;
  name: string;
  description: string;
  category: string;
  requiredCapabilities: string[];
  dashboard?: {
    tile: WidgetDashboardTile;
    tags?: string[];
  };
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetWithInstallDto extends WidgetDto {
  installed: boolean;
  enabledAt?: string;
  settings?: Record<string, unknown> | null;
}

export class WidgetNotFoundError extends Error {
  constructor(slug: string) {
    super(`Widget with slug "${slug}" not found`);
    this.name = 'WidgetNotFoundError';
  }
}

function parseWidgetConfig(value: Prisma.JsonValue | null | undefined): StoredWidgetConfig {
  if (typeof value === 'undefined' || value === null) {
    return {};
  }

  const parsed = StoredWidgetConfigSchema.safeParse(value);
  if (!parsed.success) {
    return {};
  }

  return parsed.data;
}

function toWidgetDto(record: Widget): WidgetDto {
  const config = parseWidgetConfig(record.config as Prisma.JsonValue | null);

  return {
    slug: record.slug,
    name: record.name,
    description: record.description,
    category: record.category,
    requiredCapabilities: record.requiredCapabilities ?? [],
    dashboard: config.dashboard,
    metadata: config.metadata,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toWidgetWithInstallDto(widget: Widget, install?: InstallRecord): WidgetWithInstallDto {
  const base = toWidgetDto(widget);

  let settings: Record<string, unknown> | null = null;
  if (install?.settings && typeof install.settings === 'object' && !Array.isArray(install.settings)) {
    settings = parseJsonRecord(install.settings);
  }

  return {
    ...base,
    installed: Boolean(install),
    enabledAt: install?.enabledAt ? install.enabledAt.toISOString() : undefined,
    settings,
  };
}

function serializeWidgetConfig(registration: WidgetRegistration): Prisma.InputJsonValue | undefined {
  if (!registration.dashboard && !registration.metadata) {
    return undefined;
  }

  return toInputJson({
    dashboard: registration.dashboard,
    metadata: registration.metadata,
  });
}

export async function registerWidget(input: unknown): Promise<{ widget: WidgetDto; created: boolean }>
export async function registerWidget(registration: WidgetRegistration): Promise<{ widget: WidgetDto; created: boolean }>
export async function registerWidget(
  input: unknown | WidgetRegistration
): Promise<{ widget: WidgetDto; created: boolean }> {
  const registration =
    typeof input === 'object' && input !== null && 'slug' in input
      ? (input as WidgetRegistration)
      : normalizeWidgetRegistration(input);

  const existing = await prisma.widget.findUnique({
    where: { slug: registration.slug },
  });

  const config = serializeWidgetConfig(registration);

  const widget = existing
    ? await prisma.widget.update({
        where: { slug: registration.slug },
        data: {
          name: registration.name,
          description: registration.description,
          category: registration.category,
          requiredCapabilities: registration.requiredCapabilities ?? [],
          config,
        },
      })
    : await prisma.widget.create({
        data: {
          slug: registration.slug,
          name: registration.name,
          description: registration.description,
          category: registration.category,
          requiredCapabilities: registration.requiredCapabilities ?? [],
          config,
        },
      });

  return {
    widget: toWidgetDto(widget),
    created: !existing,
  };
}

export async function listWidgetsForTenant(tenantId: string): Promise<WidgetWithInstallDto[]> {
  const [widgets, installs] = await Promise.all([
    prisma.widget.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    prisma.tenantWidget.findMany({
      where: { tenantId },
      select: {
        widgetSlug: true,
        enabledAt: true,
        settings: true,
      },
    }),
  ]);

  const installMap = new Map<string, InstallRecord>();
  for (const install of installs) {
    installMap.set(install.widgetSlug, {
      enabledAt: install.enabledAt,
      settings: install.settings,
    });
  }

  return widgets.map((widget) => toWidgetWithInstallDto(widget, installMap.get(widget.slug)));
}

export async function installWidgetForTenant(params: {
  tenantId: string;
  widgetSlug: string;
  settings?: Record<string, unknown>;
  clerkId?: string;
}): Promise<WidgetWithInstallDto> {
  const widget = await prisma.widget.findUnique({ where: { slug: params.widgetSlug } });

  if (!widget) {
    throw new WidgetNotFoundError(params.widgetSlug);
  }

  const tenantClient = createTenantClient({ tenantId: params.tenantId, userId: params.clerkId });

  const settingsJson =
    typeof params.settings === 'undefined' ? undefined : toInputJson(params.settings);

  const updateData: Prisma.TenantWidgetUpdateInput = {
    enabledAt: new Date(),
  };

  if (typeof settingsJson !== 'undefined') {
    updateData.settings = settingsJson;
  }

  const install = await tenantClient.tenantWidget.upsert({
    where: {
      tenantId_widgetSlug: {
        tenantId: params.tenantId,
        widgetSlug: params.widgetSlug,
      },
    },
    create: {
      tenantId: params.tenantId,
      widgetSlug: params.widgetSlug,
      settings: settingsJson,
    },
    update: updateData,
  });

  return toWidgetWithInstallDto(widget, {
    enabledAt: install.enabledAt,
    settings: install.settings,
  });
}

export async function uninstallWidgetForTenant(params: {
  tenantId: string;
  widgetSlug: string;
  clerkId?: string;
}): Promise<void> {
  const tenantClient = createTenantClient({ tenantId: params.tenantId, userId: params.clerkId });

  try {
    await tenantClient.tenantWidget.delete({
      where: {
        tenantId_widgetSlug: {
          tenantId: params.tenantId,
          widgetSlug: params.widgetSlug,
        },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return;
    }
    throw error;
  }
}
