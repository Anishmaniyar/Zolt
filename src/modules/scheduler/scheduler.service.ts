import * as SchedulerRepository from './scheduler.repository.js';
import { enqueueJobs, enqueueExecutions } from '../../infrastructure/queue/queue.js';
import { config } from '../../config/env.config.js';
import * as OutboxRepository from '../outbox/outbox.repository.js';
import * as IdempotencyRepository from '../idempotency/idempotency.repository.js';
import * as LeaseRepository from '../leases/leases.repository.js';
import * as ExecutionService from '../executions/execution.service.js';
import { logger } from '../../shared/logger/logger.js';

// Claims jobs whose scheduled time has arrived and prepares them for queueing.
const processDueJobs = async () => {
  try {
    const fetchAndClaimJobs = await SchedulerRepository.processJobTransaction(
      config.scheduler.batch,
    );

    if (fetchAndClaimJobs.length === 0) return;

    for (const job of fetchAndClaimJobs) {
      logger.info(
        {
          event: 'job.claimed',
          schedulerId: config.scheduler.id,
          jobId: job.id,
        },
        'JOB CLAIMED',
      );
    }

    // NOTE: no direct enqueue here.
    // processJobTransaction already wrote
    // outbox(job_id) PENDING inside the same DB transaction.
    // processPendingOutbox is the SOLE publisher.
  } catch (error) {
    logger.error(
      {
        event: 'scheduler.error',
        schedulerId: config.scheduler.id,
        error,
      },
      'SCHEDULER JOB PROCESSING FAILED',
    );
  }
};

// Claims retry executions whose retry time has arrived and prepares them for queueing.
const processDueExecutions = async () => {
  try {
    const fetchAndClaimExecutions = await SchedulerRepository.processExecutionTransactions(
      config.scheduler.batch,
    );

    if (fetchAndClaimExecutions.length === 0) return;

    for (const execution of fetchAndClaimExecutions) {
      logger.info(
        {
          event: 'execution.claimed',
          schedulerId: config.scheduler.id,
          executionId: execution.id,
          jobId: execution.job_id,
          attempt: execution.attempt,
        },
        'EXECUTION CLAIMED',
      );
    }

    // NOTE: no direct enqueue here.
    // processExecutionTransactions already wrote
    // outbox(execution_id) PENDING inside the same DB transaction.
  } catch (error) {
    logger.error(
      {
        event: 'scheduler.error',
        schedulerId: config.scheduler.id,
        error,
      },
      'SCHEDULER EXECUTION PROCESSING FAILED',
    );
  }
};

// Publishes claimed outbox rows to BullMQ.
// This is the sole place that enqueues jobs and executions to BullMQ.
const processPendingOutbox = async () => {
  try {
    const claimedOutbox = await OutboxRepository.claimPendingOutbox(config.scheduler.batch);

    if (claimedOutbox.length === 0) return 0;

    const jobOutboxes = claimedOutbox.filter((outbox) => outbox.job_id !== null);

    const executionOutboxes = claimedOutbox.filter((outbox) => outbox.execution_id !== null);

    try {
      if (jobOutboxes.length > 0) {
        await enqueueJobs(
          jobOutboxes.map((outbox) => ({
            id: outbox.job_id,
          })),
        );
      }
    } catch (error) {
      await OutboxRepository.resetOutboxToPending(jobOutboxes.map((outbox) => outbox.id));

      throw error;
    }

    try {
      if (executionOutboxes.length > 0) {
        await enqueueExecutions(
          executionOutboxes.map((outbox) => ({
            id: outbox.execution_id,
          })),
        );
      }
    } catch (error) {
      await OutboxRepository.resetOutboxToPending(executionOutboxes.map((outbox) => outbox.id));

      throw error;
    }

    return claimedOutbox.length;
  } catch (error) {
    logger.error(
      {
        event: 'scheduler.error',
        schedulerId: config.scheduler.id,
        error,
      },
      'SCHEDULER OUTBOX PROCESSING FAILED',
    );

    return 0;
  }
};

// Resets idempotency records stuck in PROCESSING past the timeout so they can be retried.
const processStaleIdempotency = async () => {
  try {
    const timeout = config.idempotemcy.processingTimeout;

    const staleRecords = await IdempotencyRepository.getStaleProcessingRecords(timeout);

    if (staleRecords.length === 0) return true;

    logger.warn(
      {
        event: 'idempotency.stale_records_found',
        schedulerId: config.scheduler.id,
        count: staleRecords.length,
      },
      'STALE IDEMPOTENCY RECORDS FOUND',
    );

    for (const record of staleRecords) {
      logger.warn(
        {
          event: 'idempotency.stale_record',
          schedulerId: config.scheduler.id,
          idempotencyId: record.id,
          jobId: record.job_id,
          processingStartedAt: record.processing_started_at,
        },
        'STALE IDEMPOTENCY RECORD',
      );
    }

    for (const record of staleRecords) {
      const resetCount = await IdempotencyRepository.resetStaleProcessingRecord(record.id, timeout);

      if (resetCount === 0) {
        logger.info(
          {
            event: 'idempotency.recovery_skipped',
            schedulerId: config.scheduler.id,
            idempotencyId: record.id,
          },
          'STALE IDEMPOTENCY RECOVERY SKIPPED',
        );
      }
    }

    return true;
  } catch (error) {
    logger.error(
      {
        event: 'scheduler.error',
        schedulerId: config.scheduler.id,
        error,
      },
      'STALE IDEMPOTENCY PROCESSING FAILED',
    );

    return false;
  }
};

// Finds expired leases and recovers each execution. One lease's
// failure must not block the rest, so each recovery is isolated.
const processExpiredLeases = async () => {
  try {
    const expiredLeases = await LeaseRepository.findExpiredLeases();

    if (expiredLeases.length === 0) return true;

    logger.warn(
      {
        event: 'lease.expired_leases_found',
        schedulerId: config.scheduler.id,
        count: expiredLeases.length,
      },
      'EXPIRED LEASES FOUND',
    );

    for (const lease of expiredLeases) {
      logger.warn(
        {
          event: 'lease.expired',
          schedulerId: config.scheduler.id,
          leaseId: lease.lease_id,
          executionId: lease.execution_id,
          workerId: lease.worker_id,
          expiredAt: lease.lease_expires_at,
          executionStatus: lease.execution_status,
        },
        'EXPIRED LEASE',
      );

      try {
        await ExecutionService.recoverExpiredExecution(lease.execution_id);
      } catch (error) {
        logger.error(
          {
            event: 'scheduler.error',
            schedulerId: config.scheduler.id,
            executionId: lease.execution_id,
            error,
          },
          'EXPIRED LEASE RECOVERY FAILED',
        );
      }
    }

    return true;
  } catch (error) {
    logger.error(
      {
        event: 'scheduler.error',
        schedulerId: config.scheduler.id,
        error,
      },
      'EXPIRED LEASE PROCESSING FAILED',
    );

    return false;
  }
};

let schedulerInterval: NodeJS.Timeout | undefined;

// Starts the scheduler tick that claims due jobs, executions, outbox rows, and expired leases.
export const startScheduler = () => {
  logger.info(
    {
      event: 'scheduler.started',
      schedulerId: config.scheduler.id,
      interval: config.scheduler.intervalSize,
    },
    'SCHEDULER STARTED',
  );

  // Runs one scheduler pass over due jobs, due executions, outbox, stale idempotency, and expired leases.
  const runTick = async () => {
    logger.info(
      {
        event: 'scheduler.tick',
        schedulerId: config.scheduler.id,
      },
      'SCHEDULER TICK',
    );

    await processDueJobs();
    await processDueExecutions();
    await processPendingOutbox();
    await processStaleIdempotency();
    await processExpiredLeases();
  };

  // Run once immediately instead of waiting for the first interval.
  void runTick();

  // Continue checking sequentially.
  schedulerInterval = setInterval(() => {
    void runTick();
  }, config.scheduler.intervalSize);
};

// Stops the scheduler tick loop.
export const stopScheduler = () => {
  if (!schedulerInterval) {
    logger.info(
      {
        event: 'scheduler.stop_skipped',
        schedulerId: config.scheduler.id,
      },
      'SCHEDULER IS NOT RUNNING',
    );

    return;
  }

  logger.info(
    {
      event: 'scheduler.stopped',
      schedulerId: config.scheduler.id,
    },
    'SCHEDULER STOPPED',
  );

  clearInterval(schedulerInterval);
  schedulerInterval = undefined;
};
