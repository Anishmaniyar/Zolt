import { config } from '../config/env.config.js';
import { logger } from '../shared/logger/logger.js';
import { renewLease } from '../modules/leases/leases.repository.js';

// Worker-local set of executions this worker currently owns.
// executionId -> workerId that acquired it.
const activeExecutions = new Map<string, string>();

let heartbeatInterval: NodeJS.Timeout | undefined;

// Tracks an execution as actively owned by this worker so its lease gets renewed.
export const registerExecution = (
  executionId: string,
  workerId: string = config.worker.id,
) => {
  activeExecutions.set(executionId, workerId);
};

// Stops tracking an execution so its lease is no longer renewed.
export const unregisterExecution = (executionId: string) => {
  activeExecutions.delete(executionId);
};

// Periodically renews the leases of executions currently being handled by this worker.
const renewActiveLeases = async () => {
  for (const [executionId, workerId] of activeExecutions) {
    try {
      const renewed = await renewLease(executionId, workerId, config.lease.duration);

      if (!renewed) {
        logger.warn(
          {
            event: 'execution.lease_renewal_failed',
            workerId,
            executionId,
          },
          'EXECUTION LEASE RENEWAL FAILED',
        );

        activeExecutions.delete(executionId);
      } else {
        logger.debug(
          {
            event: 'execution.lease_renewed',
            workerId,
            executionId,
            leaseExpiresAt: renewed.lease_expires_at,
          },
          'EXECUTION LEASE RENEWED',
        );
      }
    } catch (error) {
      logger.error(
        {
          event: 'execution.lease_renewal_error',
          workerId,
          executionId,
          error,
        },
        'EXECUTION LEASE RENEWAL ERROR',
      );
    }
  }
};

// Starts the background timer that keeps owned execution leases alive.
export const startHeartbeat = (intervalMs: number = config.lease.heartbeatInterval) => {
  if (heartbeatInterval) return;

  logger.info(
    {
      event: 'heartbeat.started',
      workerId: config.worker.id,
      interval: intervalMs,
    },
    'HEARTBEAT STARTED',
  );

  heartbeatInterval = setInterval(() => {
    void renewActiveLeases();
  }, intervalMs);
};

// Stops the background lease-renewal timer.
export const stopHeartbeat = () => {
  if (!heartbeatInterval) return;

  clearInterval(heartbeatInterval);
  heartbeatInterval = undefined;

  logger.info(
    {
      event: 'heartbeat.stopped',
      workerId: config.worker.id,
    },
    'HEARTBEAT STOPPED',
  );
};
