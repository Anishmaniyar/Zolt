import * as SchedulerRepository from './scheduler.repository.js';
import { enqueueJobs, enqueueExecutions } from '../../infrastructure/queue/queue.js';
import { config } from '../../config/env.config.js';
import * as OutboxRepository from '../outbox/outbox.repository.js';
import * as IdempotencyRepository from '../idempotency/idempotency.repository.js';

// fetches jobs from db
const processDueJobs = async () => {
  try {
    console.log('Scheduler Job tick');

    console.log(`🔍 [${config.scheduler.id}] checking database for due jobs...`);

    const fetchAndClaimJobs = await SchedulerRepository.processJobTransaction(
      config.scheduler.batch,
    );

    if (fetchAndClaimJobs.length === 0) return;

    console.log(
      `🎯 [${config.scheduler.id}] ATOMICALLY CLAIMED: ${fetchAndClaimJobs.length} jobs. Outbox publisher will enqueue them.`,
    );

    // NOTE: no direct enqueue here. processJobTransaction already wrote
    // outbox(job_id) PENDING inside the same DB transaction.
    // processPendingOutbox is the SOLE publisher (transactional outbox).
  } catch (error) {
    console.error(`❌ [${config.scheduler.id}] Scheduler tick failed:`, error);
  }
};

// fetch executions from db
const processDueExecutions = async () => {
  try {
    console.log('Scheduler Execution tick');

    console.log(`🔍 [${config.scheduler.id}] checking database for due executions...`);

    const fetchAndClaimExecutions = await SchedulerRepository.processExecutionTransactions(
      config.scheduler.batch,
    );

    if (fetchAndClaimExecutions.length === 0) return;

    console.log(
      `🎯 [${config.scheduler.id}] ATOMICALLY CLAIMED: ${fetchAndClaimExecutions.length} executions. Outbox publisher will enqueue them.`,
    );

    // NOTE: no direct enqueue here. processExecutionTransactions already wrote
    // outbox(execution_id) PENDING inside the same DB transaction.
  } catch (error) {
    console.error(`❌ [${config.scheduler.id}] Scheduler tick failed:`, error);
  }
};

// fetch the pending outbox rows and publish them exactly once per claim.
// This is the SOLE place that enqueues to BullMQ (transactional outbox).
const processPendingOutbox = async () => {
  try {
    console.log('Scheduler Outbox tick');

    console.log(`🔍 [${config.scheduler.id}] checking database for due outbox ...`);

    const claimedOutbox = await OutboxRepository.claimPendingOutbox(config.scheduler.batch);

    if (claimedOutbox.length === 0) return 0;

    console.log(
      `🎯 [${config.scheduler.id}] CLAIMED: ${claimedOutbox.length} pending outbox records.`,
    );

    const jobOutboxes = claimedOutbox.filter((outbox) => outbox.job_id !== null);

    const executionOutboxes = claimedOutbox.filter((outbox) => outbox.execution_id !== null);

    console.log(
      `📤 Publishing ${jobOutboxes.length} jobs and ${executionOutboxes.length} executions.`,
    );

    try {
      if (jobOutboxes.length > 0) {
        await enqueueJobs(
          jobOutboxes.map((outbox) => ({
            id: outbox.job_id,
          })),
        );
      }
    } catch (error) {
      // Redis down after DB claim -> give rows back so next tick retries.
      await OutboxRepository.resetOutboxToPending(jobOutboxes.map((o) => o.id));
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
      await OutboxRepository.resetOutboxToPending(executionOutboxes.map((o) => o.id));
      throw error;
    }

    return claimedOutbox.length;
  } catch (error) {
    console.error(`❌ [${config.scheduler.id}] Scheduler tick failed:`, error);
    return 0;
  }
};

const processStaleIdempotency = async () => {
  try {
    const timeout = config.idempotemcy.processingTimeout;
    const staleRecords = await IdempotencyRepository.getStaleProcessingRecords(timeout);

    if (staleRecords.length === 0) return true;

    console.log(`⚠️ Found ${staleRecords.length} stale idempotency records`);

    for (const record of staleRecords) {
      console.log(
        `Stale idempotency: ${record.id} | Job: ${record.job_id} | Started: ${record.processing_started_at}`,
      );
    }

    for (const record of staleRecords) {
      const resetCount = await IdempotencyRepository.resetStaleProcessingRecord(
        record.id,
        timeout,
      );

      if (resetCount === 0) {
        console.log(
          `⏭️ Skipped stale idempotency ${record.id}: no longer stale (re-claimed or completed).`,
        );
      }
    }

    return true;
  } catch (error) {
    console.error(`❌ [${config.scheduler.id}] Stale idempotency tick failed:`, error);
    return false;
  }
};
let schedulerInterval: NodeJS.Timeout | undefined;

export const startScheduler = () => {
  console.log(
    `⏱️  Scheduler [${config.scheduler.id}] activated. Polling every ${config.scheduler.intervalSize}ms.`,
  );

  // Run sequentially: claim DB rows first, then publish them in the same tick.
  // The old code fired all three with `void` concurrently, so rows claimed
  // in this tick were missed by the publisher until the NEXT tick.
  const runTick = async () => {
    await processDueJobs();
    await processDueExecutions();
    await processPendingOutbox();
    await processStaleIdempotency();
  };

  // Run once immediately instead of waiting 15 seconds.
  void runTick();

  // Then continue checking sequentially.
  schedulerInterval = setInterval(() => {
    void runTick();
  }, config.scheduler.intervalSize);
};

export const stopScheduler = () => {
  if (!schedulerInterval) {
    console.log('Scheduler is not running.');
    return;
  }

  console.log('Stopping scheduler...');
  clearInterval(schedulerInterval);
  schedulerInterval = undefined;
};
