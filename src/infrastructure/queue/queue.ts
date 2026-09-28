import { Queue } from 'bullmq';
import { redis } from '../../infrastructure/redis/redis.js';
import { config } from '../../config/env.config.js';

export const jobQueue = new Queue('jobs', {
  connection: redis,
  // DB retry is the source of truth, so BullMQ itself must not retry.
  // Cleanup prevents unbounded growth of completed/failed sets in Redis.
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

const isDuplicateJobError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('already exists') || message.includes('duplicate');
};

export async function enqueueJobs(jobs: Array<{ id: string }>) {
  if (jobs.length === 0) return [];

  try {
    return await jobQueue.addBulk(
      jobs.map((job) => ({
        name: 'execute-job',
        // Deterministic BullMQ id: re-publishing the same outbox row
        // (e.g. after a resetToPending) does not create a second Redis job.
        opts: { jobId: `job-${job.id}` },
        data: {
          jobId: job.id,
        },
      })),
    );
  } catch (error) {
    if (isDuplicateJobError(error)) {
      console.warn('[queue] duplicate execute-job ignored (already queued)');
      return [];
    }
    throw error;
  }
}

export async function enqueueExecutions(executions: Array<{ id: string }>) {
  if (executions.length === 0) return [];

  try {
    return await jobQueue.addBulk(
      executions.map((execution) => ({
        name: 'execute-execution',
        opts: { jobId: `exec-${execution.id}` },
        data: {
          executionId: execution.id,
        },
      })),
    );
  } catch (error) {
    if (isDuplicateJobError(error)) {
      console.warn('[queue] duplicate execute-execution ignored (already queued)');
      return [];
    }
    throw error;
  }
}

export async function configureQueue() {
  await jobQueue.setGlobalConcurrency(config.worker.globalConcurrency);
}

export async function closeQueue() {
  await jobQueue.close();
}
