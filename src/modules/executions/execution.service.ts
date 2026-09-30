import { handlerRegistry } from '../../handlers/handler.registry.js';
import AppError from '../../shared/errors/appError.js';
import * as ExecutionRepository from './execution.repository.js';
import * as JobRepository from '../jobs/jobs.repository.js';
import * as IdempotencyRepository from '../idempotency/idempotency.repository.js';
import * as LeaseRepository from '../leases/leases.repository.js';
import * as OutboxRepository from '../outbox/outbox.repository.js';
import { calculateRetryAt } from '../../utils/retry.utils.js';
import { pool } from '../../infrastructure/database/pool.js';
import { logger } from '../../shared/logger/logger.js';
import { config } from '../../config/env.config.js';
import { registerExecution, unregisterExecution } from '../../workers/heartbeat.js';

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

// Creates the first execution for a job and runs it immediately on this worker.
export const createNewExecution = async (job: JobForExecution, workerId: string = config.worker.id) => {
  const execution = await ExecutionRepository.newInitialExecution(job.id, 1, null, 'QUEUED');

  if (!execution) {
    throw new AppError('Error generating the execution', 500);
  }

  logger.info(
    {
      event: 'execution.created',
      executionId: execution.id,
      jobId: execution.job_id,
      attempt: execution.attempt,
      status: execution.status,
    },
    'EXECUTION CREATED',
  );

  await executeExistingExecution(execution.id, workerId);

  return true;
};

// Executes an existing queued execution.
// Acquires the lease, claims idempotency, starts the execution and job,
// runs the registered handler, and handles success, failure, timeout, and retry paths.
export const executeExistingExecution = async (
  executionId: string,
  workerId: string = config.worker.id,
) => {
  const execution = await ExecutionRepository.getExecutionById(executionId);

  if (!execution) {
    throw new AppError(`Execution ${executionId} not found`, 404);
  }

  if (execution.status !== 'QUEUED') return false;

  const lease = await LeaseRepository.acquireExecutionLease(
    execution.id,
    workerId,
    config.lease.duration,
  );

  if (!lease) {
    logger.info(
      {
        event: 'execution.lease_not_acquired',
        workerId,
        executionId: execution.id,
        jobId: execution.job_id,
      },
      'EXECUTION LEASE NOT ACQUIRED',
    );

    return false;
  }

  logger.info(
    {
      event: 'execution.lease_acquired',
      workerId,
      executionId: execution.id,
      jobId: execution.job_id,
      leaseExpiresAt: lease.lease_expires_at,
    },
    'EXECUTION LEASE ACQUIRED',
  );

  registerExecution(execution.id, workerId);

  const job = await JobRepository.getJobById(execution.job_id);

  if (!job) {
    unregisterExecution(execution.id);
    throw new AppError(`Job ${execution.job_id} not found`, 404);
  }

  const idempotencyRecord = await IdempotencyRepository.getByJobId(job.id);

  if (!idempotencyRecord) {
    unregisterExecution(execution.id);
    throw new AppError(`Idempotency record not found for job ${job.id}`, 500);
  }

  const idempotencyKey = idempotencyRecord.idempotency_key;

  const claimResult = await IdempotencyRepository.claimIdempotency(idempotencyKey);

  if (claimResult === 'ALREADY_COMPLETED') {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await ExecutionRepository.successExecution(client, execution.id);

      await client.query('COMMIT');

      unregisterExecution(execution.id);

      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      unregisterExecution(execution.id);
      throw error;
    } finally {
      client.release();
    }
  }

  if (claimResult === 'ALREADY_PROCESSING') {
    unregisterExecution(execution.id);
    return false;
  }

  const execution1 = await ExecutionRepository.startExecution(execution.id);

  logger.info(
    {
      event: 'execution.started',
      executionId: execution1.id,
      jobId: execution1.job_id,
      attempt: execution1.attempt,
      status: execution1.status,
      started_at: execution1.started_at,
    },
    'EXECUTION STARTED',
  );

  await JobRepository.startJob(job.id);

  const handler = handlerRegistry[job.type as JobType];

  if (!handler) {
    const errorMessage = `No handler registered for type: ${job.type}`;
    const noHandlerClient = await pool.connect();
    let noHandlerResult;

    try {
      await noHandlerClient.query('BEGIN');

      await ExecutionRepository.failedExecution(noHandlerClient, execution.id, errorMessage);

      noHandlerResult = await JobRepository.failedJob(noHandlerClient, job.id);

      await noHandlerClient.query('COMMIT');
    } catch (error) {
      await noHandlerClient.query('ROLLBACK');
      unregisterExecution(execution.id);
      throw error;
    } finally {
      noHandlerClient.release();
    }

    logger.error(
      {
        event: 'execution.failed',
        executionId: execution.id,
        jobId: job.id,
        attempt: execution.attempt,
        status: 'FAILED',
        error: errorMessage,
      },
      'EXECUTION FAILED',
    );

    logger.error(
      {
        event: 'job.failed',
        jobId: noHandlerResult.id,
        type: noHandlerResult.type,
        scheduleType: noHandlerResult.schedule_type,
        maxAttempts: noHandlerResult.max_attempts,
        status: noHandlerResult.status,
      },
      'JOB FAILED',
    );

    unregisterExecution(execution.id);

    throw new AppError(errorMessage, 500);
  }

  const controller = new AbortController();

  let timeoutTriggered = false;

  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, config.execution.timeout);

  try {
    await handler(job.payload ?? {}, controller.signal);
  } catch (error) {
    // Handle execution timeout separately
    if (timeoutTriggered) {
      // Timeout with retry
      if (execution.attempt < job.max_attempts) {
        const retryTimeoutClient = await pool.connect();

        try {
          await retryTimeoutClient.query('BEGIN');

          await ExecutionRepository.timedOutExecution(retryTimeoutClient, execution.id);

          await IdempotencyRepository.resetToPending(retryTimeoutClient, idempotencyKey);

          const nextAttempt = execution.attempt + 1;
          const retryNumber = nextAttempt - 1;
          const retryAt = calculateRetryAt(retryNumber);

          const newExecution = await ExecutionRepository.newExecution(
            retryTimeoutClient,
            job.id,
            nextAttempt,
            retryAt,
            'SCHEDULED',
          );

          if (!newExecution) {
            throw new AppError('Error generating the retry execution', 500);
          }

          await retryTimeoutClient.query('COMMIT');

          logger.warn(
            {
              event: 'execution.timed_out',
              executionId: execution.id,
              jobId: execution.job_id,
              attempt: execution.attempt,
              status: 'TIMED_OUT',
            },
            'EXECUTION TIMED OUT',
          );

          logger.info(
            {
              event: 'execution.retry_scheduled',
              jobId: newExecution.job_id,
              failedExecutionId: execution.id,
              retryExecutionId: newExecution.id,
              attempt: newExecution.attempt,
              retryAt: newExecution.retry_at,
            },
            'EXECUTION RETRY SCHEDULED',
          );

          unregisterExecution(execution.id);

          return false;
        } catch (error) {
          await retryTimeoutClient.query('ROLLBACK');
          unregisterExecution(execution.id);
          throw error;
        } finally {
          retryTimeoutClient.release();
        }
      }

      // Final timeout
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        await ExecutionRepository.timedOutExecution(client, execution.id);

        const result = await JobRepository.failedJob(client, job.id);

        await client.query('COMMIT');

        logger.warn(
          {
            event: 'execution.timed_out',
            executionId: execution.id,
            jobId: execution.job_id,
            attempt: execution.attempt,
            status: 'TIMED_OUT',
          },
          'EXECUTION TIMED OUT',
        );

        logger.error(
          {
            event: 'job.failed',
            jobId: result.id,
            type: result.type,
            scheduleType: result.schedule_type,
            maxAttempts: result.max_attempts,
            status: result.status,
          },
          'JOB FAILED',
        );

        unregisterExecution(execution.id);

        return false;
      } catch (error) {
        await client.query('ROLLBACK');
        unregisterExecution(execution.id);
        throw error;
      } finally {
        client.release();
      }
    }

    // Normal execution failure
    const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';

    console.error(`Error running execution ${execution.id}:`, error);

    if (execution.attempt < job.max_attempts) {
      // Failure with retry
      const retryClient = await pool.connect();

      try {
        await retryClient.query('BEGIN');

        const execution2 = await ExecutionRepository.failedExecution(
          retryClient,
          execution.id,
          errorMessage,
        );

        await IdempotencyRepository.resetToPending(retryClient, idempotencyKey);

        const nextAttempt = execution.attempt + 1;
        const retryNumber = nextAttempt - 1;
        const retryAt = calculateRetryAt(retryNumber);

        const newExecution = await ExecutionRepository.newExecution(
          retryClient,
          job.id,
          nextAttempt,
          retryAt,
          'SCHEDULED',
        );

        if (!newExecution) {
          throw new AppError('Error generating the retry execution', 500);
        }

        await retryClient.query('COMMIT');

        logger.error(
          {
            event: 'execution.failed',
            executionId: execution2.id,
            jobId: execution2.job_id,
            attempt: execution2.attempt,
            status: execution2.status,
            started_at: execution2.started_at,
            completed_at: execution2.completed_at,
            error: execution2.error,
          },
          'EXECUTION FAILED',
        );

        logger.info(
          {
            event: 'execution.retry_scheduled',
            jobId: newExecution.job_id,
            failedExecutionId: execution.id,
            retryExecutionId: newExecution.id,
            attempt: newExecution.attempt,
            retryAt: newExecution.retry_at,
          },
          'EXECUTION RETRY SCHEDULED',
        );

        unregisterExecution(execution.id);

        return false;
      } catch (error) {
        await retryClient.query('ROLLBACK');
        unregisterExecution(execution.id);
        throw error;
      } finally {
        retryClient.release();
      }
    }

    // Final failure
    const finalFailureClient = await pool.connect();

    try {
      await finalFailureClient.query('BEGIN');

      const execution2 = await ExecutionRepository.failedExecution(
        finalFailureClient,
        execution.id,
        errorMessage,
      );

      const result = await JobRepository.failedJob(finalFailureClient, job.id);

      await finalFailureClient.query('COMMIT');

      logger.error(
        {
          event: 'execution.failed',
          executionId: execution2.id,
          jobId: execution2.job_id,
          attempt: execution2.attempt,
          status: execution2.status,
          started_at: execution2.started_at,
          completed_at: execution2.completed_at,
          error: execution2.error,
        },
        'EXECUTION FAILED',
      );

      logger.error(
        {
          event: 'job.failed',
          jobId: result.id,
          type: result.type,
          scheduleType: result.schedule_type,
          maxAttempts: result.max_attempts,
          status: result.status,
        },
        'JOB FAILED',
      );

      unregisterExecution(execution.id);

      return false;
    } catch (error) {
      await finalFailureClient.query('ROLLBACK');
      unregisterExecution(execution.id);
      throw error;
    } finally {
      finalFailureClient.release();
    }
  } finally {
    clearTimeout(timeout);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await IdempotencyRepository.completeIdempotency(client, idempotencyKey);

    const execution3 = await ExecutionRepository.successExecution(client, execution.id);

    const result = await JobRepository.successJob(client, job.id);

    await client.query('COMMIT');

    logger.info(
      {
        event: 'execution.completed',
        executionId: execution3.id,
        jobId: execution3.job_id,
        attempt: execution3.attempt,
        status: execution3.status,
      },
      'EXECUTION COMPLETED',
    );

    logger.info(
      {
        event: 'job.completed',
        jobId: result.id,
        type: result.type,
        scheduleType: result.schedule_type,
        maxAttempts: result.max_attempts,
        status: result.status,
      },
      'JOB COMPLETED',
    );

    unregisterExecution(execution.id);

    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    unregisterExecution(execution.id);
    throw error;
  } finally {
    client.release();
  }
};

// Recovers an execution whose worker lease has expired.
// Verifies the execution and lease state, checks idempotency,
// then either completes the existing execution or creates a replacement execution.
export const recoverExpiredExecution = async (executionId: string) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const execution = await ExecutionRepository.getExecutionByIdForUpdate(client, executionId);

    if (!execution) {
      throw new AppError(`Execution ${executionId} not found`, 404);
    }

    if (execution.status !== 'RUNNING') {
      await client.query('ROLLBACK');
      return false;
    }

    const lease = await LeaseRepository.findLeaseByExecutionIdForUpdate(client, executionId);

    if (!lease || new Date(lease.lease_expires_at) > new Date()) {
      await client.query('ROLLBACK');
      return false;
    }

    const idempotency = await IdempotencyRepository.getByJobIdForUpdate(
      client,
      execution.job_id,
    );

    if (!idempotency) {
      await client.query('ROLLBACK');

      logger.error(
        {
          event: 'execution.recovery_invariant',
          executionId: execution.id,
          jobId: execution.job_id,
          reason: 'idempotency_record_missing',
        },
        'EXECUTION RECOVERY INVARIANT FAILURE',
      );

      return false;
    }

    if (idempotency.status === 'COMPLETED') {
      const execution2 = await ExecutionRepository.successExecution(client, execution.id);

      const result = await JobRepository.successJob(client, execution.job_id);

      await client.query('COMMIT');

      logger.info(
        {
          event: 'execution.recovered',
          executionId: execution2.id,
          jobId: execution2.job_id,
          attempt: execution2.attempt,
          status: execution2.status,
          reason: 'idempotency_completed',
        },
        'EXECUTION RECOVERED AS COMPLETED',
      );

      logger.info(
        {
          event: 'job.completed',
          jobId: result.id,
          type: result.type,
          scheduleType: result.schedule_type,
          maxAttempts: result.max_attempts,
          status: result.status,
        },
        'JOB COMPLETED',
      );

      return true;
    }

    if (idempotency.status !== 'PROCESSING') {
      await client.query('ROLLBACK');

      logger.error(
        {
          event: 'execution.recovery_invariant',
          executionId: execution.id,
          jobId: execution.job_id,
          reason: 'unexpected_idempotency_status',
          idempotencyStatus: idempotency.status,
        },
        'EXECUTION RECOVERY INVARIANT FAILURE',
      );

      return false;
    }

    const crashed = await ExecutionRepository.markWorkerCrashed(client, execution.id);

    if (!crashed) {
      await client.query('ROLLBACK');
      return false;
    }

    const nextAttempt = execution.attempt + 1;
    const retryNumber = nextAttempt - 1;
    const retryAt = calculateRetryAt(retryNumber);

    const newExecution = await ExecutionRepository.newExecution(
      client,
      execution.job_id,
      nextAttempt,
      retryAt,
      'SCHEDULED',
    );

    if (!newExecution) {
      throw new AppError('Error generating the recovery execution', 500);
    }

    await OutboxRepository.createExecutionOutbox(client, newExecution.id);

    await client.query('COMMIT');

    logger.warn(
      {
        event: 'execution.worker_crashed',
        executionId: crashed.id,
        jobId: crashed.job_id,
        attempt: crashed.attempt,
        status: crashed.status,
        workerId: lease.worker_id,
      },
      'EXECUTION WORKER CRASHED',
    );

    logger.info(
      {
        event: 'execution.retry_scheduled',
        jobId: newExecution.job_id,
        failedExecutionId: execution.id,
        retryExecutionId: newExecution.id,
        attempt: newExecution.attempt,
        retryAt: newExecution.retry_at,
      },
      'EXECUTION RETRY SCHEDULED',
    );

    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Lists all executions belonging to a job.
export const getJobExecutionsService = async (data: { id: string }) => {
  const job = await JobRepository.getJobById(data.id);

  if (!job) {
    throw new AppError('Error finding the job', 404);
  }

  return await ExecutionRepository.getExecutionsByJobId(data.id);
};
