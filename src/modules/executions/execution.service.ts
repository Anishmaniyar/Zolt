import { handlerRegistry } from '../../handlers/handler.registry.js';
import AppError from '../../shared/errors/appError.js';
import * as ExecutionRepository from './execution.repository.js';
import * as JobRepository from '../jobs/jobs.repository.js';
import * as IdempotencyRepository from '../idempotency/idempotency.repository.js';
import { calculateRetryAt } from '../../utils/retry.utils.js';
import { pool } from '../../infrastructure/database/pool.js';

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
  const execution = await ExecutionRepository.newExecution(job.id, 1, null, 'QUEUED');

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

  if (execution.status !== 'QUEUED') return false;

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
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await ExecutionRepository.successExecution(client, execution.id);

      await client.query('COMMIT');

      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Another worker is currently running this logical operation.
  if (claimResult === 'ALREADY_PROCESSING') {
    return false;
  }

  await ExecutionRepository.startExecution(execution.id);
  await JobRepository.startJob(job.id);

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

  // run handler if it fails run the logic to check if the more execution exists or not
  try {
    await handler(job.payload ?? {});
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
      const retryNumber = nextAttempt - 1;

      const retryAt = calculateRetryAt(retryNumber);

      const newExecution = await ExecutionRepository.newExecution(
        job.id,
        nextAttempt,
        retryAt,
        'SCHEDULED',
      );

      if (!newExecution) {
        throw new AppError('Error generating the retry execution', 500);
      }

      return false;
    }

    // No attempts remaining.
    await JobRepository.failedJob(job.id);

    return false;
  }

  const client = await pool.connect();

  // running the transaction to change the records togethere
  try {
    await client.query('BEGIN');

    await IdempotencyRepository.completeIdempotency(client, idempotencyKey);
    await ExecutionRepository.successExecution(client, execution.id);
    await JobRepository.successJob(client, job.id);

    await client.query('COMMIT');

    return true;
  } catch (error) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
};

export const getJobExecutionsService = async (data: { id: string }) => {
  const job = await JobRepository.getJobById(data.id);

  if (!job) {
    throw new AppError('Error finding the job', 404);
  }

  return await ExecutionRepository.getExecutionsByJobId(data.id);
};
