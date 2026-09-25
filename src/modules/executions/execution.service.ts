import { handlerRegistry } from '../../handlers/handler.registry.js';
import AppError from '../../shared/errors/appError.js';
import * as ExecutionRepository from './execution.repository.js';
import * as JobRepository from '../jobs/jobs.repository.js';
import * as IdempotencyRepository from '../idempotency/idempotency.repository.js';
import { enqueueExecution } from '../../infrastructure/queue/queue.js';

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

export interface ExecutionInterface {
  id: string;
  job_id: string;
  attempt: number;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export const createNewExecution = async (job: JobForExecution) => {
  const execution = await ExecutionRepository.newExecution(job, 1);

  if (!execution) {
    throw new AppError('Error generating the execution', 500);
  }

  await executeExistingExecution(execution.id);

  return true;
};

export const executeExistingExecution = async (executionId: string) => {
  const execution = await ExecutionRepository.getExecutionById(executionId);

  if (!execution) {
    throw new AppError(`Execution ${executionId} not found`, 404);
  }

  const job = await JobRepository.getJobById(execution.job_id);

  if (!job) {
    throw new AppError(`Job ${execution.job_id} not found`, 404);
  }

  // IDENTITY OF THE LOGICAL OPERATION
  const idempotencyRecord = await IdempotencyRepository.getByJobId(job.id);

  if (!idempotencyRecord) {
    throw new AppError(`Idempotency record not found for job ${job.id}`, 500);
  }

  const idempotencyKey = idempotencyRecord.idempotency_key;

  // ATOMIC CLAIM
  const claimResult = await IdempotencyRepository.claimIdempotency(idempotencyKey);

  // Another worker already finished this logical operation.
  if (claimResult === 'ALREADY_COMPLETED') {
    await ExecutionRepository.successExecution(execution.id);

    return true;
  }

  // Another worker is currently running this logical operation.
  if (claimResult === 'ALREADY_PROCESSING') {
    return false;
  }

  // ONLY CLAIMED REACHES THE HANDLER
  const handler = handlerRegistry[job.type as JobType];

  if (!handler) {
    await ExecutionRepository.failedExecution(
      execution.id,
      `No handler registered for type: ${job.type}`,
    );

    await JobRepository.failedJob(job.id);

    throw new AppError(`No handler registered for type: ${job.type}`, 500);
  }

  try {
    await handler(job.payload ?? {});

    await IdempotencyRepository.completeIdempotency(idempotencyKey);

    await ExecutionRepository.successExecution(execution.id);
    await JobRepository.successJob(job.id);

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';

    console.error(`Error running execution ${execution.id}:`, error);

    // Current execution failed.
    await ExecutionRepository.failedExecution(execution.id, errorMessage);

    // Retry if attempts remain.
    if (execution.attempt < job.max_attempts) {
      // Reset the claim so the retry can re-acquire it.
      await IdempotencyRepository.resetToPending(idempotencyKey);

      const nextAttempt = execution.attempt + 1;

      const newExecution = await ExecutionRepository.newExecution(job, nextAttempt);

      if (!newExecution) {
        throw new AppError('Error generating the retry execution', 500);
      }

      await enqueueExecution(newExecution.id);

      return false;
    }

    // No attempts remaining.
    await JobRepository.failedJob(job.id);

    return false;
  }
};

export const getJobExecutionsService = async (data: { id: string }) => {
  const job = await JobRepository.getJobById(data.id);

  if (!job) {
    throw new AppError('Error finding the job', 404);
  }

  return await ExecutionRepository.getExecutionsByJobId(data.id);
};
