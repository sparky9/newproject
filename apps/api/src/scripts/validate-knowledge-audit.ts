import 'tsconfig-paths/register.js';
import { randomUUID } from 'node:crypto';

import { prisma } from '@ocsuite/db';
import type { PrismaClient as PrismaServiceClient } from '@prisma/client';
import { initializeCrypto, generateMasterKey, isValidMasterKey } from '@ocsuite/crypto';

import { KnowledgeIngestService } from '../services/knowledge-ingest.js';
import { KnowledgeAdminService } from '../services/knowledge-admin.js';

interface ScriptResult {
  tenantId: string;
  userId: string;
  sourceId: string;
  auditEvents: Array<{
    id: string;
    event: string;
    summary: string;
    entryCount: number;
    createdAt: string;
  }>;
}

async function main(): Promise<void> {
  const slugSuffix = randomUUID().split('-')[0];
  const tenantName = `Audit Demo ${slugSuffix}`;
  const tenantSlug = `audit-demo-${slugSuffix}`;

  console.log('🏁 Starting knowledge audit validation script...');

  const providedMasterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (providedMasterKey && isValidMasterKey(providedMasterKey)) {
    initializeCrypto(providedMasterKey);
  } else {
    const ephemeralKey = generateMasterKey();
    initializeCrypto(ephemeralKey);
    process.env.MASTER_ENCRYPTION_KEY = ephemeralKey;
    console.warn('⚠️ Using generated MASTER_ENCRYPTION_KEY for validation run.');
  }

  let tenantId: string | undefined;
  let userId: string | undefined;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: tenantName,
        slug: tenantSlug,
      },
    });
    tenantId = tenant.id;
    console.log('🏢 Created tenant', tenantId);

    const user = await prisma.user.create({
      data: {
        name: 'Audit Demo User',
        email: `${tenantSlug}@demo.local`,
        clerkId: `clerk_${slugSuffix}`,
      },
    });
    userId = user.id;
    console.log('👤 Created user', userId);

    await prisma.tenantMember.create({
      data: {
        tenantId,
        userId,
        role: 'owner',
      },
    });

    const ingest = new KnowledgeIngestService({
      prisma,
      tenantId,
      userId,
    });

    console.log('📝 Ingesting manual note...');
    const ingestionSummary = await ingest.ingestManualNote({
      title: 'Quarterly Finance Update',
      content: 'Revenue grew 24% quarter-over-quarter with steady margins.',
      personas: ['cfo'],
      tags: ['finance', 'report'],
      retentionPolicy: 'rolling_90_days',
    });

    const sourceId = ingestionSummary.sourceId;
    console.log('📥 Created knowledge source', sourceId);

    const admin = new KnowledgeAdminService({
      prisma,
      tenantId,
      actorId: userId,
    });

    console.log('📦 Exporting knowledge source...');
    await admin.exportSource(sourceId);

    console.log('🗑️ Deleting knowledge source...');
    await admin.deleteSource(sourceId);

    const db = prisma as unknown as PrismaServiceClient;

    const auditEvents = await db.knowledgeAuditEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });

    const result: ScriptResult = {
      tenantId,
      userId,
      sourceId,
      auditEvents: auditEvents.map((event) => ({
        id: event.id,
        event: event.event,
        summary: event.summary,
        entryCount: event.entryCount,
        createdAt: event.createdAt.toISOString(),
      })),
    };

    console.log('✅ Knowledge audit validation complete');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Knowledge audit validation failed', error);
    process.exitCode = 1;
  } finally {
    if (tenantId) {
      console.log('🧹 Cleaning up demo tenant...');
      await prisma.tenant.delete({ where: { id: tenantId } }).catch((cleanupError) => {
        console.warn('Failed to delete tenant during cleanup', cleanupError);
      });
    }

    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Unhandled error in knowledge audit validation script', error);
  process.exit(1);
});
