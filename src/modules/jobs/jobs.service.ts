import { da, id } from 'zod/locales';
import AppError from '../../shared/errors/appError.js';
import * as JobRepository from './jobs.repository.js';
import type { GetJobsQuery } from './jobs.types.js';

export const createJobService = async (data: {
  title: string;
  type: string;
  schedule_type: 'IMMEDIATE' | 'ONCE';
  payload?: Record<string, unknown>;
  run_at?: string | Date;
  max_attempts: number;
}) => {
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

  const createJobRecord = await JobRepository.createJob(createJobData);

  if (!createJobRecord) {
    throw new AppError('Error creating the job', 500);
  }

  return createJobRecord;
};

export const getJobByIdService = async (data: { id: string }) => {
  const jobData = await JobRepository.getJobById(data.id);

  if (!jobData) {
    throw new AppError('Error finding the job', 404);
  }

  return jobData;
};

export const getJobsService = async (query: GetJobsQuery) => {
  const data = await JobRepository.getJobs(query);

  return data;
};

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

  return cancelledJob;
};
