import { Queue } from 'bullmq';
import { redis } from '../../infrastructure/redis/redis.js';
import { config } from '../../config/env.config.js';

export const jobQueue = new Queue('jobs', {
  connection: redis,
  // defaultJobOptions: {
  //   backoff: { type: 'exponential', delay: 2000, jitter: 0.5 },
  //   removeOnComplete: false,
  //   removeOnFail: false,
  // },
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

export async function enqueueExecutions(executions: Array<{ id: string }>) {
  return await jobQueue.addBulk(
    executions.map((execution) => ({
      name: 'execute-execution',
      data: {
        executionId: execution.id,
      },
    })),
  );
}

export async function configureQueue() {
  await jobQueue.setGlobalConcurrency(config.worker.globalConcurrency);
}

export async function closeQueue() {
  await jobQueue.close();
}
