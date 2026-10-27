import * as ReconciliationRepository from './queue-reconciliation.repository.js';
import {
  enqueueExecutions,
  enqueueJobs,
  getQueueExecution,
  getQueueJob,
  isQueueEntryRunnable,
  removeTerminalQueueEntry,
} from '../../infrastructure/queue/queue.js';
import { config } from '../../config/env.config.js';
import { logger } from '../../shared/logger/logger.js';

// Requeues QUEUED jobs/executions missing from BullMQ.
// One pass: fetch stale suspects, keep runnable entries, requeue the rest.
export const processQueueReconciliation = async () => {
  try {
    const batch = config.queueReconciliation.batchSize;
    const minAgeMs = config.queueReconciliation.minAge;

    const [jobSuspects, executionSuspects] = await Promise.all([
      ReconciliationRepository.getReconciliationCandidatesForJobs(batch, minAgeMs),
      ReconciliationRepository.getReconciliationCandidatesForExecutions(batch, minAgeMs),
    ]);

    if (jobSuspects.length === 0 && executionSuspects.length === 0) return 0;

    const missingJobs: Array<{ id: string }> = [];

    for (const job of jobSuspects) {
      try {
        const entry = await getQueueJob(job.id);
        const runnable = await isQueueEntryRunnable(entry);

        if (runnable) continue;

        // A retained terminal entry occupies the deterministic id, so the
        // re-enqueue below would be a silent no-op. Remove it first.
        await removeTerminalQueueEntry(entry);

        logger.warn(
          {
            event: 'queue.reconciliation_candidate',
            schedulerId: config.scheduler.id,
            jobId: job.id,
          },
          'QUEUE RECONCILIATION CANDIDATE',
        );

        missingJobs.push({ id: job.id });
      } catch (error) {
        logger.error(
          {
            event: 'queue.reconciliation_lookup_failed',
            schedulerId: config.scheduler.id,
            jobId: job.id,
            error,
          },
          'QUEUE RECONCILIATION LOOKUP FAILED',
        );
      }
    }

    const missingExecutions: Array<{ id: string }> = [];

    for (const execution of executionSuspects) {
      try {
        const entry = await getQueueExecution(execution.id);
        const runnable = await isQueueEntryRunnable(entry);

        if (runnable) continue;

        await removeTerminalQueueEntry(entry);

        logger.warn(
          {
            event: 'queue.reconciliation_candidate',
            schedulerId: config.scheduler.id,
            executionId: execution.id,
            jobId: execution.job_id,
          },
          'QUEUE RECONCILIATION CANDIDATE',
        );

        missingExecutions.push({ id: execution.id });
      } catch (error) {
        logger.error(
          {
            event: 'queue.reconciliation_lookup_failed',
            schedulerId: config.scheduler.id,
            executionId: execution.id,
            error,
          },
          'QUEUE RECONCILIATION LOOKUP FAILED',
        );
      }
    }

    try {
      if (missingJobs.length > 0) await enqueueJobs(missingJobs);
    } catch (error) {
      logger.error(
        {
          event: 'queue.reconciliation_requeue_failed',
          schedulerId: config.scheduler.id,
          count: missingJobs.length,
          error,
        },
        'QUEUE RECONCILIATION REQUEUE FAILED',
      );
    }

    try {
      if (missingExecutions.length > 0) await enqueueExecutions(missingExecutions);
    } catch (error) {
      logger.error(
        {
          event: 'queue.reconciliation_requeue_failed',
          schedulerId: config.scheduler.id,
          count: missingExecutions.length,
          error,
        },
        'QUEUE RECONCILIATION REQUEUE FAILED',
      );
    }

    return missingJobs.length + missingExecutions.length;
  } catch (error) {
    logger.error(
      {
        event: 'queue.reconciliation_failed',
        schedulerId: config.scheduler.id,
        error,
      },
      'QUEUE RECONCILIATION FAILED',
    );

    return 0;
  }
};
