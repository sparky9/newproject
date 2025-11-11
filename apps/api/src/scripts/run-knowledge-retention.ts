#!/usr/bin/env tsx
import { knowledgeRetentionQueue } from '../queue/index.js';
import { enqueueKnowledgeRetention } from '../queue/client.js';
import { defaultKnowledgeRetentionRepeat } from '../workers/knowledge-retention.worker.js';

const isDryRun = process.argv.includes('--dry-run');
const tenantIdArgIndex = process.argv.findIndex((arg) => arg === '--tenant');
const tenantId = tenantIdArgIndex >= 0 ? process.argv[tenantIdArgIndex + 1] : undefined;
const limitArgIndex = process.argv.findIndex((arg) => arg === '--limit');
const limitValue = limitArgIndex >= 0 ? Number.parseInt(process.argv[limitArgIndex + 1] ?? '', 10) : undefined;

async function main() {
  try {
    const result = await enqueueKnowledgeRetention(
      {
        tenantId,
        dryRun: isDryRun,
        limit: Number.isFinite(limitValue) ? limitValue : undefined,
      },
      {
        jobId: `manual-knowledge-retention-${Date.now()}`,
      }
    );

    console.log('Knowledge retention job enqueued:', result);

    const repeatables = await knowledgeRetentionQueue.getRepeatableJobs();
    const hasRecurring = repeatables.some((job) => job.name === 'knowledge-retention');

    if (!hasRecurring) {
      await knowledgeRetentionQueue.add(
        'knowledge-retention',
        {},
        {
          repeat: defaultKnowledgeRetentionRepeat,
          jobId: 'knowledge-retention-recurring',
        }
      );
      console.log('Scheduled recurring retention sweep:', defaultKnowledgeRetentionRepeat);
    }
  } finally {
    await knowledgeRetentionQueue.close();
  }
}

main().catch((error) => {
  console.error('Failed to enqueue knowledge retention job', error);
  process.exitCode = 1;
});
