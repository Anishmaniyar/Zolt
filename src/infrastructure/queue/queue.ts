import { Queue } from 'bullmq';
import { redis } from '../../infrastructure/redis/redis.js';

export const jobQueue = new Queue('jobs', {
  connection: redis,
  defaultJobOptions: {
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

export async function enqueueJobs(jobs: Array<{ id: string }>) {
  return await jobQueue.addBulk(
    jobs.map((job) => ({
      name: 'execute-job',
      data: {
        jobId: job.id,
      },
    })),
  );
}
