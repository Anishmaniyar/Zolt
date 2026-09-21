import * as SchedulerRepository from './scheduler.repository.js';
import { enqueueJobs } from '../../infrastructure/queue/queue.js';

const processDueJobs = async () => {
  console.log('Scheduler tick');

  const dueJobs = await SchedulerRepository.findDueJobs();

  if (dueJobs.length === 0) {
    return;
  }

  console.log('Due jobs:', dueJobs.length);

  const jobIds = dueJobs.map((job) => job.id);

  const claimedJobs = await SchedulerRepository.ClaimJobs(jobIds);

  if (claimedJobs.length === 0) return;

  console.log('Claimed jobs:', claimedJobs.length);

  // add the jobs to queue
  await enqueueJobs(claimedJobs);
};

export const startScheduler = () => {
  console.log('Scheduler started');

  // Run once immediately instead of waiting 15 seconds.
  processDueJobs();

  // Then continue checking every 15 seconds.
  setInterval(processDueJobs, 15000);
};
