import { Queue, Job } from 'bullmq';
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

// Detects BullMQ duplicate-ID errors so re-enqueues of an already queued row can be skipped.
const isDuplicateJobError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  return message.includes('already exists') || message.includes('duplicate');
};

// Builds the deterministic BullMQ ID for a job.
export function getJobQueueId(jobId: string) {
  return `job-${jobId}`;
}

// Builds the deterministic BullMQ ID for an execution.
export function getExecutionQueueId(executionId: string) {
  return `exec-${executionId}`;
}

// Finds a BullMQ job using its exact queue ID.
export async function queueLookup(queueJobId: string): Promise<Job | undefined> {
  return await jobQueue.getJob(queueJobId);
}

// Adds jobs to BullMQ for processing.
export async function enqueueJobs(jobs: Array<{ id: string }>) {
  if (jobs.length === 0) return [];

  try {
    return await jobQueue.addBulk(
      jobs.map((job) => ({
        name: 'execute-job',

        // Deterministic BullMQ ID.
        opts: {
          jobId: getJobQueueId(job.id),
        },

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

// Adds executions to BullMQ for processing.
export async function enqueueExecutions(executions: Array<{ id: string }>) {
  if (executions.length === 0) return [];

  try {
    return await jobQueue.addBulk(
      executions.map((execution) => ({
        name: 'execute-execution',

        opts: {
          jobId: getExecutionQueueId(execution.id),
        },

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

// Applies the global concurrency limit to the shared job queue.
export async function configureQueue() {
  await jobQueue.setGlobalConcurrency(config.worker.globalConcurrency);
}

// Closes the shared job queue connection.
export async function closeQueue() {
  await jobQueue.close();
}
