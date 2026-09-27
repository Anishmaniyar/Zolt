import * as SchedulerRepository from './scheduler.repository.js';
import { enqueueJobs, enqueueExecutions } from '../../infrastructure/queue/queue.js';
import { config } from '../../config/env.config.js';
import * as OutboxRepository from '../outbox/outbox.repository.js';

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
      `🎯 [${config.scheduler.id}] ATOMICALLY CLAIMED: ${fetchAndClaimJobs.length} jobs.`,
    );

    // add the jobs to queue
    await enqueueJobs(fetchAndClaimJobs);
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
      `🎯 [${config.scheduler.id}] ATOMICALLY CLAIMED: ${fetchAndClaimExecutions.length} executions.`,
    );

    // add the jobs to queue
    await enqueueExecutions(fetchAndClaimExecutions);
  } catch (error) {
    console.error(`❌ [${config.scheduler.id}] Scheduler tick failed:`, error);
  }
};

// fetch the pending executions which where queued but never got added to the queue
const processPendingOutbox = async () => {
  try {
    console.log('Scheduler Outbox tick');

    console.log(`🔍 [${config.scheduler.id}] checking database for due outbox ...`);

    const fetchAndClaimOutbox = await OutboxRepository.getPendingOutbox(config.scheduler.batch);

    if (fetchAndClaimOutbox.length === 0) return 0;

    console.log(
      `🎯 [${config.scheduler.id}] FOUND: ${fetchAndClaimOutbox.length} pending outbox records.`,
    );

    // add the jobs to queue

    const jobOutboxes = fetchAndClaimOutbox.filter((outbox) => outbox.job_id !== null);

    const executionOutboxes = fetchAndClaimOutbox.filter((outbox) => outbox.execution_id !== null);

    console.log(
      `📤 Publishing ${jobOutboxes.length} jobs and ${executionOutboxes.length} executions.`,
    );

    if (jobOutboxes.length > 0) {
      await enqueueJobs(
        jobOutboxes.map((outbox) => ({
          id: outbox.job_id,
        })),
      );
    }

    if (executionOutboxes.length > 0) {
      await enqueueExecutions(
        executionOutboxes.map((outbox) => ({
          id: outbox.execution_id,
        })),
      );
    }

    for (const outbox of fetchAndClaimOutbox) {
      await OutboxRepository.markPublished(outbox.id);
    }
  } catch (error) {
    console.error(`❌ [${config.scheduler.id}] Scheduler tick failed:`, error);
  }
};

let schedulerInterval: NodeJS.Timeout | undefined;

export const startScheduler = () => {
  console.log(
    `⏱️  Scheduler [${config.scheduler.id}] activated. Polling every ${config.scheduler.intervalSize}ms.`,
  );

  // Run once immediately instead of waiting 15 seconds.
  processDueJobs();
  processDueExecutions();
  processPendingOutbox();

  // Then continue checking every 15 seconds.
  schedulerInterval = setInterval(() => {
    void processDueJobs();
    void processDueExecutions();
    void processPendingOutbox();
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
