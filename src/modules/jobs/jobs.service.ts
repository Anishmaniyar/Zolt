import crypto from 'node:crypto';
import AppError from '../../shared/errors/appError.js';
import * as JobRepository from './jobs.repository.js';
import type { GetJobsQuery } from './jobs.types.js';
import { jobsTotal, jobsTotalFinalState } from '../../shared/metrics/jobs.metrics.js';

export interface CreateJobOptions {
  // Optional client-supplied Idempotency-Key. Reusing it returns the job
  // created by the first submission instead of creating a duplicate.
  idempotencyKey?: string;
}

// Resolves the submission key: the client value when present, otherwise a
// fresh UUID that keeps every submission distinct.
const resolveIdempotencyKey = (idempotencyKey?: string): string => {
  if (idempotencyKey === undefined) return crypto.randomUUID();

  const trimmed = idempotencyKey.trim();

  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new AppError('Idempotency-Key must be between 1 and 200 characters', 400);
  }

  return trimmed;
};

// Creates a job with an idempotency key, resolving its run time from the schedule type.
export const createJobService = async (
  data: {
    title: string;
    type: string;
    schedule_type: 'IMMEDIATE' | 'ONCE';
    payload?: Record<string, unknown>;
    run_at?: string | Date;
    max_attempts: number;
  },
  options: CreateJobOptions = {},
) => {
  let runAt: Date;

  if (data.schedule_type === 'IMMEDIATE') {
    runAt = new Date();
  } else {
    if (!data.run_at) {
      throw new AppError('run_at is required for scheduled jobs', 400);
    }

    runAt = new Date(data.run_at);
  }

  const createJobData: JobRepository.CreateJobData = {
    title: data.title,
    type: data.type,
    schedule_type: data.schedule_type,
    payload: data.payload,
    run_at: runAt,
    max_attempts: data.max_attempts,
  };

  // IDENTITY OF THE LOGICAL OPERATION
  const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);

  const { job, deduplicated } = await JobRepository.createJobWithIdempotency({
    job: createJobData,
    idempotencyKey,
  });

  if (!job) {
    throw new AppError('Error creating the job', 500);
  }

  // A deduplicated submission is not a new job and must not be counted again.
  if (!deduplicated) {
    jobsTotal.labels(job.type, job.schedule_type).inc();
  }

  return { job, deduplicated };
};

// Fetches a single job by its ID.
export const getJobByIdService = async (data: { id: string }) => {
  const jobData = await JobRepository.getJobById(data.id);

  if (!jobData) {
    throw new AppError('Error finding the job', 404);
  }

  return jobData;
};

// Lists jobs matching the given filters with pagination.
export const getJobsService = async (query: GetJobsQuery) => {
  const data = await JobRepository.getJobs(query);

  return data;
};

// Cancels a SCHEDULED job so the scheduler never picks it up.
export const cancelJobService = async (data: { id: string }) => {
  const job = await JobRepository.getJobById(data.id);

  if (!job) {
    throw new AppError('Error finding the job', 404);
  }

  if (job.status !== 'SCHEDULED') {
    throw new AppError('Job cannot be cancelled in its current status', 409);
  }

  const cancelledJob = await JobRepository.cancelJobStatus(data.id);

  if (!cancelledJob) {
    throw new AppError('Job could not be cancelled', 409);
  }

  jobsTotalFinalState.labels(cancelledJob.type, cancelledJob.schedule_type, 'CANCELLED').inc();

  return cancelledJob;
};
