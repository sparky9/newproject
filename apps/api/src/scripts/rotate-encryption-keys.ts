#!/usr/bin/env tsx
import 'dotenv/config';

import { prisma } from '@ocsuite/db';
import {
  initializeCrypto,
  encryptForTenant,
  decryptForTenantWithVersion,
  getCurrentKeyVersion,
} from '@ocsuite/crypto';

import { config } from '../config/index.js';
import { apiLogger } from '../utils/logger.js';
import { KNOWLEDGE_ENCRYPTION_CONTEXT } from '../services/knowledge-constants.js';
import { EXTERNAL_CONTENT_PLACEHOLDER } from '../services/knowledge-storage.js';

const DEFAULT_BATCH_SIZE = 100;

interface RotationScope {
  dryRun: boolean;
  batchSize: number;
  tenantId?: string;
}

interface ParsedOptions extends RotationScope {
  targetVersion?: number;
  includeConnectors: boolean;
  includeKnowledge: boolean;
}

interface ConnectorRotationResult {
  processed: number;
  skipped: number;
}

interface KnowledgeRotationResult {
  processed: number;
  skipped: number;
  external: number;
}

type RotatableConnector = {
  id: string;
  tenantId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  encryptionKeyVersion: number | null;
};

type RotatableKnowledgeEntry = {
  id: string;
  tenantId: string | null;
  content: string;
  encryptionKeyVersion: number | null;
  storageKey: string | null;
  sourceId: string | null;
  sourceRef: {
    storageStrategy: 'managed_postgres' | 'external_s3';
  } | null;
};

function printUsage(): void {
  console.log(`\nUsage: pnpm --filter api tsx src/scripts/rotate-encryption-keys.ts [options]\n\nOptions:\n  --dry-run               Perform decrypt/encrypt validation without persisting updates\n  --tenant <tenantId>     Limit rotation to a single tenant\n  --target-version <int>  Override the master key version used for re-encryption\n  --batch-size <int>      Number of records processed per batch (default ${DEFAULT_BATCH_SIZE})\n  --only <target>         Restrict to 'connectors' or 'knowledge'\n  --skip-connectors       Skip rotating connector tokens\n  --skip-knowledge        Skip rotating knowledge entries\n  -h, --help              Show this help message\n`);
}

function getFlagValue(flag: string, args: string[]): string | undefined {
  const flagWithEquals = `${flag}=`;
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }
    if (current === flag) {
      const next = args[index + 1];
      if (next && !next.startsWith('--')) {
        return next;
      }
      return undefined;
    }

    if (current.startsWith(flagWithEquals)) {
  return current.slice(flagWithEquals.length);
    }
  }
  return undefined;
}

function parseCommandLine(args: string[]): ParsedOptions {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');

  const tenantFlag = getFlagValue('--tenant', args)?.trim();
  const tenantId = tenantFlag?.length ? tenantFlag : undefined;

  const batchFlag = getFlagValue('--batch-size', args);
  const batchSize = batchFlag ? Number.parseInt(batchFlag, 10) : DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Invalid --batch-size value. Provide a positive integer.');
  }

  const targetFlag = getFlagValue('--target-version', args);
  let targetVersion: number | undefined;
  if (targetFlag) {
    const parsed = Number.parseInt(targetFlag, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('Invalid --target-version value. Provide a positive integer.');
    }
    targetVersion = parsed;
  }

  const onlyFlag = getFlagValue('--only', args)?.toLowerCase();
  let includeConnectors = true;
  let includeKnowledge = true;

  if (onlyFlag) {
    if (onlyFlag === 'connectors') {
      includeKnowledge = false;
    } else if (onlyFlag === 'knowledge' || onlyFlag === 'knowledge-entries') {
      includeConnectors = false;
    } else if (onlyFlag !== 'all') {
      throw new Error("Invalid value for --only. Use 'connectors', 'knowledge', or 'all'.");
    }
  }

  if (args.includes('--skip-connectors')) {
    includeConnectors = false;
  }
  if (args.includes('--skip-knowledge')) {
    includeKnowledge = false;
  }

  if (!includeConnectors && !includeKnowledge) {
    throw new Error('At least one rotation target must remain enabled.');
  }

  return {
    dryRun,
    tenantId,
    batchSize,
    targetVersion,
    includeConnectors,
    includeKnowledge,
  };
}

function initializeCryptoRegistry(): void {
  initializeCrypto({
    currentKey: config.masterEncryptionKey,
    currentKeyVersion: config.masterEncryptionKeyVersion,
    previousKeys:
      Object.keys(config.masterEncryptionPreviousKeys ?? {}).length > 0
        ? config.masterEncryptionPreviousKeys
        : undefined,
  });
}

async function rotateConnectorSecrets(
  targetVersion: number,
  scope: RotationScope,
): Promise<ConnectorRotationResult> {
  let processed = 0;
  let skipped = 0;
  let cursor: string | null = null;

  while (true) {
  const connectors: RotatableConnector[] = await prisma.connector.findMany({
      where: {
        encryptionKeyVersion: {
          lt: targetVersion,
        },
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      },
      orderBy: { id: 'asc' },
      take: scope.batchSize,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        tenantId: true,
        encryptedAccessToken: true,
        encryptedRefreshToken: true,
        encryptionKeyVersion: true,
      },
    });

    if (connectors.length === 0) {
      break;
    }

    for (const connector of connectors) {
      const legacyVersion = connector.encryptionKeyVersion ?? 1;

      try {
        const accessTokenPlain = decryptForTenantWithVersion(
          connector.encryptedAccessToken,
          connector.tenantId,
          'connector-tokens',
          legacyVersion,
        );

  const newAccessToken = encryptForTenant(accessTokenPlain, connector.tenantId, 'connector-tokens');

        let newRefreshToken: string | null = null;
        if (connector.encryptedRefreshToken) {
          const refreshTokenPlain = decryptForTenantWithVersion(
            connector.encryptedRefreshToken,
            connector.tenantId,
            'connector-tokens',
            legacyVersion,
          );
          newRefreshToken = encryptForTenant(refreshTokenPlain, connector.tenantId, 'connector-tokens');
        }

        if (scope.dryRun) {
          apiLogger.debug('Dry-run: connector secrets would be rotated', {
            connectorId: connector.id,
            tenantId: connector.tenantId,
            legacyVersion,
            targetVersion,
          });
        } else {
          await prisma.connector.update({
            where: { id: connector.id },
            data: {
              encryptedAccessToken: newAccessToken,
              encryptedRefreshToken: newRefreshToken,
              encryptionKeyVersion: targetVersion,
            },
          });
        }

        processed += 1;
      } catch (error) {
        skipped += 1;
        apiLogger.error('Failed to rotate connector secrets', {
          connectorId: connector.id,
          tenantId: connector.tenantId,
          legacyVersion,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const lastConnector = connectors[connectors.length - 1];
    cursor = lastConnector ? lastConnector.id : null;
  }

  return { processed, skipped };
}

async function rotateKnowledgeEntries(
  targetVersion: number,
  scope: RotationScope,
): Promise<KnowledgeRotationResult> {
  let processed = 0;
  let skipped = 0;
  let external = 0;
  let cursor: string | null = null;

  while (true) {
  const entries: RotatableKnowledgeEntry[] = await prisma.knowledgeEntry.findMany({
      where: {
        encryptionKeyVersion: {
          lt: targetVersion,
        },
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      },
      orderBy: { id: 'asc' },
      take: scope.batchSize,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        tenantId: true,
        content: true,
        encryptionKeyVersion: true,
        storageKey: true,
        sourceId: true,
        sourceRef: {
          select: {
            storageStrategy: true,
          },
        },
      },
    });

    if (entries.length === 0) {
      break;
    }

    for (const entry of entries) {
      const legacyVersion = entry.encryptionKeyVersion ?? 1;
      const tenantId = entry.tenantId ?? 'company_hq';
  const storageStrategy = entry.sourceRef?.storageStrategy ?? null;
      const isExternal = storageStrategy === 'external_s3';

      if (isExternal || (entry.storageKey && entry.content === EXTERNAL_CONTENT_PLACEHOLDER)) {
        external += 1;
        apiLogger.warn('Skipping knowledge entry rotation; content stored externally', {
          entryId: entry.id,
          sourceId: entry.sourceId,
          storageStrategy,
        });
        continue;
      }

      try {
        const plaintext = decryptForTenantWithVersion(
          entry.content,
          tenantId,
          KNOWLEDGE_ENCRYPTION_CONTEXT,
          legacyVersion,
        );
        const newContent = encryptForTenant(plaintext, tenantId, KNOWLEDGE_ENCRYPTION_CONTEXT);

        if (scope.dryRun) {
          apiLogger.debug('Dry-run: knowledge entry would be rotated', {
            entryId: entry.id,
            tenantId: entry.tenantId,
            sourceId: entry.sourceId,
            legacyVersion,
            targetVersion,
          });
        } else {
          await prisma.knowledgeEntry.update({
            where: { id: entry.id },
            data: {
              content: newContent,
              encryptionKeyVersion: targetVersion,
            },
          });
        }

        processed += 1;
      } catch (error) {
        skipped += 1;
        apiLogger.error('Failed to rotate knowledge entry', {
          entryId: entry.id,
          tenantId: entry.tenantId,
          legacyVersion,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const lastEntry = entries[entries.length - 1];
    cursor = lastEntry ? lastEntry.id : null;
  }

  return { processed, skipped, external };
}

async function main(): Promise<void> {
  const options = parseCommandLine(process.argv.slice(2));

  initializeCryptoRegistry();
  const resolvedTargetVersion = options.targetVersion ?? getCurrentKeyVersion();

  apiLogger.info('Starting encryption key rotation', {
    targetVersion: resolvedTargetVersion,
    dryRun: options.dryRun,
    batchSize: options.batchSize,
    tenantId: options.tenantId ?? null,
    includeConnectors: options.includeConnectors,
    includeKnowledge: options.includeKnowledge,
  });

  try {
    let connectorResult: ConnectorRotationResult | null = null;
    let knowledgeResult: KnowledgeRotationResult | null = null;

    if (options.includeConnectors) {
      connectorResult = await rotateConnectorSecrets(resolvedTargetVersion, options);
      apiLogger.info('Connector secret rotation complete', {
        ...connectorResult,
        dryRun: options.dryRun,
      });
    }

    if (options.includeKnowledge) {
      knowledgeResult = await rotateKnowledgeEntries(resolvedTargetVersion, options);
      apiLogger.info('Knowledge entry rotation complete', {
        ...knowledgeResult,
        dryRun: options.dryRun,
      });
    }

    apiLogger.info('Encryption key rotation finished', {
      dryRun: options.dryRun,
      targetVersion: resolvedTargetVersion,
      connectorSummary: connectorResult,
      knowledgeSummary: knowledgeResult,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  apiLogger.error('Rotation job failed', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exitCode = 1;
});
