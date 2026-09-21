import { handlerRegistry } from '../../handlers/handler.registry.js';
import AppError from '../../shared/errors/appError.js';
import * as ExecutionRepository from './execution.repository.js';
import * as JobRepository from '../jobs/jobs.repository.js';

export type JobType = 'SEND_EMAIL' | 'CREATE_CAMPAIGN';

export interface JobForExecution {
  id: string;
  title: string;
  type: JobType;
  schedule_type: 'IMMEDIATE' | 'ONCE';
  payload?: Record<string, unknown>;
  run_at: Date;
  max_attempts: number;
}

export const createNewExecution = async (job: JobForExecution) => {
  // const create new execution
  const execution = await ExecutionRepository.newExecution(job);

  if (!execution) {
    throw new AppError('Error generating the execution', 500);
  }

  // resolve handler
  const handler = handlerRegistry[job.type];

  if (!handler) {
    await ExecutionRepository.failedExecution(
      execution.id,
      `No handler registered for type: ${job.type}`,
    );

    // The Job itself also failed.
    await JobRepository.failedJob(job.id);

    throw new AppError(`No handler registered for type: ${job.type}`, 500);
  }

  // execute handler
  try {
    await handler(job.payload ?? {});

    await ExecutionRepository.successExecution(execution.id);

    await JobRepository.successJob(job.id);

    return true;
  } catch (error) {
    console.error('Error running the job', 400);

    await ExecutionRepository.failedExecution(
      execution.id,
      error instanceof Error ? error.message : 'Unknown execution error',
    );

    await JobRepository.failedJob(job.id);

    throw error;
  }
};

export const getJobExecutionsService = async (data: { id: string }) => {
  const job = await JobRepository.getJobById(data.id);

  if (!job) {
    throw new AppError('Error finding the job', 404);
  }

  const executions = await ExecutionRepository.getExecutionsByJobId(data.id);

  return executions;
};
