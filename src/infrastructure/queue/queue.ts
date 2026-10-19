import { Queue, Job } from 'bullmq';
import { redis } from '../../infrastructure/redis/redis.js';
import { config } from '../../config/env.config.js';
import { logger } from '../../shared/logger/logger.js';

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
      logger.warn({ event: 'queue.duplicate_job_skipped', jobKind: 'execute-job' }, 'QUEUE DUPLICATE JOB SKIPPED');

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
      logger.warn(
        { event: 'queue.duplicate_job_skipped', jobKind: 'execute-execution' },
        'QUEUE DUPLICATE JOB SKIPPED',
      );

      return [];
    }

    throw error;
  }
}

// Finds a BullMQ job for a DB job ID using its deterministic queue ID.
export async function getQueueJob(jobId: string): Promise<Job | null> {
  const job = await jobQueue.getJob(getJobQueueId(jobId));

  return job ?? null;
}

// Finds a BullMQ job for a DB execution ID using its deterministic queue ID.
export async function getQueueExecution(executionId: string): Promise<Job | null> {
  const job = await jobQueue.getJob(getExecutionQueueId(executionId));

  return job ?? null;
}

export async function isQueueEntryRunnable(job: Job | null): Promise<boolean> {
  if (!job) return false;

  const state = await job.getState();

  return (
    state === 'waiting' ||
    state === 'active' ||
    state === 'delayed' ||
    state === 'prioritized' ||
    state === 'waiting-children'
  );
}

// Applies the global concurrency limit to the shared job queue.
export async function configureQueue() {
  await jobQueue.setGlobalConcurrency(config.worker.globalConcurrency);
}

// Closes the shared job queue connection.
export async function closeQueue() {
  await jobQueue.close();
}
