import * as SchedulerRepository from './scheduler.repository.js';
import { enqueueJobs } from '../../infrastructure/queue/queue.js';
import { config } from '../../config/env.config.js';

// fetches jobs from db
const processDueJobs = async () => {
  try {
    console.log('Scheduler tick');

    console.log(`🔍 [${config.scheduler.id}] checking database for due jobs...`);

    // const dueJobs = await SchedulerRepository.findDueJobs();

    // if (dueJobs.length === 0) {
    //   return;
    // }

    // console.log('Due jobs:', dueJobs.length);

    // const jobIds = dueJobs.map((job) => job.id);

    // const claimedJobs = await SchedulerRepository.ClaimJobs(jobIds);

    // if (claimedJobs.length === 0) return;

    // console.log('Claimed jobs:', claimedJobs.length);

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

export const startScheduler = () => {
  console.log(
    `⏱️  Scheduler [${config.scheduler.id}] activated. Polling every ${config.scheduler.intervalSize}ms.`,
  );

  // Run once immediately instead of waiting 15 seconds.
  processDueJobs();

  // Then continue checking every 15 seconds.
  setInterval(processDueJobs, config.scheduler.intervalSize);
};
