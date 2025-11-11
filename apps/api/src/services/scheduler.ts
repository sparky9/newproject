import { prisma } from '@ocsuite/db';
import { enqueueSyncAnalytics } from '../queue/client.js';
import { createContextLogger } from '../utils/logger.js';
import { parseJsonRecord } from '../utils/json.js';

const schedulerLogger = createContextLogger('scheduler');

/**
 * Schedule automatic analytics syncs for all active Google connectors
 *
 * This function should be called periodically (e.g., every hour) to sync
 * analytics data for all active connectors.
 */
export async function scheduleAnalyticsSyncs(): Promise<void> {
  try {
    schedulerLogger.info('Running scheduled analytics syncs');

    // We need to query all tenants since we don't have a global prisma client
    // In a real implementation, you'd want to maintain a list of tenants
    // or query them from a central location. For now, we'll need to iterate
    // through connectors using a system-level query.

    // Find all active Google connectors across all tenants
    const connectors = await prisma.connector.findMany({
      where: {
        provider: 'google',
        status: 'active',
      },
      select: {
        id: true,
        tenantId: true,
        metadata: true,
      },
    });

    schedulerLogger.info(`Found ${connectors.length} active Google connectors`);

    // Enqueue sync jobs for each connector
    const results = await Promise.allSettled(
      connectors.map(async (connector) => {
        const metadataRecord = connector.metadata ? parseJsonRecord(connector.metadata) : {};
        const propertyId = metadataRecord.propertyId;

        if (typeof propertyId !== 'string' || !propertyId.trim()) {
          schedulerLogger.debug('Skipping connector without property ID', {
            connectorId: connector.id,
            tenantId: connector.tenantId,
          });
          return;
        }

        return enqueueSyncAnalytics(
          connector.tenantId,
          connector.id,
          {
            triggeredBy: 'scheduled-sync',
            priority: 5, // Lower priority for scheduled syncs
          }
        );
      })
    );

    // Count successes and failures
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    schedulerLogger.info('Scheduled analytics syncs completed', {
      total: connectors.length,
      successful,
      failed,
    });

    // Log any failures
    results.forEach((result, index) => {
      const connector = connectors[index];
      if (!connector) {
        return;
      }
      if (result.status === 'rejected') {
        schedulerLogger.error('Failed to enqueue analytics sync', {
          connectorId: connector.id,
          tenantId: connector.tenantId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  } catch (error) {
    schedulerLogger.error('Failed to schedule analytics syncs', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Start the analytics sync scheduler
 *
 * Runs analytics syncs every hour
 *
 * @returns Timer ID that can be used to stop the scheduler
 */
export function startAnalyticsSyncScheduler(): NodeJS.Timeout {
  schedulerLogger.info('Starting analytics sync scheduler');

  // Run immediately on startup
  scheduleAnalyticsSyncs();

  // Then run every hour
  const interval = setInterval(() => {
    scheduleAnalyticsSyncs();
  }, 60 * 60 * 1000); // Every hour

  return interval;
}

/**
 * Stop the analytics sync scheduler
 *
 * @param timerId - Timer ID returned from startAnalyticsSyncScheduler
 */
export function stopAnalyticsSyncScheduler(timerId: NodeJS.Timeout): void {
  schedulerLogger.info('Stopping analytics sync scheduler');
  clearInterval(timerId);
}
