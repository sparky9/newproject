#!/usr/bin/env node
import { prisma } from '@ocsuite/db';
import { apiLogger } from '../src/utils/logger.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function parseRetention(): number {
  const raw = process.env.ACCESS_LOG_RETENTION_DAYS ?? '90';
  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`ACCESS_LOG_RETENTION_DAYS must be a positive integer. Received: ${raw}`);
  }

  return parsed;
}

async function pruneAccessLogs(): Promise<void> {
  const retentionDays = parseRetention();
  const cutoff = new Date(Date.now() - retentionDays * DAY_IN_MS);
  const dryRun = process.argv.includes('--dry-run');
  const batchSize = 1000;

  apiLogger.info({ retentionDays, cutoff: cutoff.toISOString(), dryRun }, 'Starting access log cleanup');

  const whereClause = { createdAt: { lt: cutoff } };

  if (dryRun) {
    const count = await prisma.accessLog.count({ where: whereClause });
    apiLogger.info({ count }, 'Dry run complete. No records deleted.');
    return;
  }

  let totalDeleted = 0;

  while (true) {
    const batch = (await prisma.accessLog.findMany({
      where: whereClause,
      select: { id: true },
      take: batchSize,
    })) as Array<{ id: string }>;

    if (batch.length === 0) {
      break;
    }

    const ids = batch.map((entry) => entry.id);
    const { count } = await prisma.accessLog.deleteMany({ where: { id: { in: ids } } });
    totalDeleted += count;

    apiLogger.info({ count, totalDeleted }, 'Deleted batch of access logs');
  }

  apiLogger.info({ totalDeleted }, 'Access log cleanup complete');
}

pruneAccessLogs()
  .catch((error) => {
    apiLogger.error({ error }, 'Access log cleanup failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {
      // ignore disconnect errors
    });
  });
