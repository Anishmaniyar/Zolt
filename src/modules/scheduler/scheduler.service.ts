import * as SchedulerRepository from './scheduler.repository.js';
import { enqueueJobs, enqueueExecutions } from '../../infrastructure/queue/queue.js';
import { config } from '../../config/env.config.js';
import * as OutboxRepository from '../outbox/outbox.repository.js';
import * as IdempotencyRepository from '../idempotency/idempotency.repository.js';
import { logger } from '../../shared/logger/logger.js';

// fetches jobs from db
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

// fetch executions from db
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

// fetch the pending outbox rows and publish them.
// This is the SOLE place that enqueues to BullMQ.
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

let schedulerInterval: NodeJS.Timeout | undefined;

export const startScheduler = () => {
  logger.info(
    {
      event: 'scheduler.started',
      schedulerId: config.scheduler.id,
      interval: config.scheduler.intervalSize,
    },
    'SCHEDULER STARTED',
  );

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
  };

  // Run once immediately instead of waiting for the first interval.
  void runTick();

  // Continue checking sequentially.
  schedulerInterval = setInterval(() => {
    void runTick();
  }, config.scheduler.intervalSize);
};

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
