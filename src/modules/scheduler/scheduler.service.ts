import * as SchedulerRepository from './scheduler.repository.js';
import { enqueueJobs, enqueueExecutions } from '../../infrastructure/queue/queue.js';
import { config } from '../../config/env.config.js';

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

let schedulerInterval: NodeJS.Timeout | undefined;

export const startScheduler = () => {
  console.log(
    `⏱️  Scheduler [${config.scheduler.id}] activated. Polling every ${config.scheduler.intervalSize}ms.`,
  );

  // Run once immediately instead of waiting 15 seconds.
  processDueJobs();
  processDueExecutions();

  // Then continue checking every 15 seconds.
  schedulerInterval = setInterval(() => {
    void processDueJobs();
    void processDueExecutions();
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
