import { pool } from '../../infrastructure/database/pool.js';
import type { PoolClient } from 'pg';

// Creates a retry/recovery execution for a job inside an existing transaction.
export const newExecution = async (
  client: PoolClient,
  jobId: string,
  attempt: number,
  retry_at: Date | null,
  status: 'SCHEDULED' | 'QUEUED' = 'SCHEDULED',
) => {
  const result = await client.query(
    `
      INSERT INTO executions (
        job_id,
        attempt,
        status,
        started_at,
        retry_at
      )
      VALUES ($1, $2, $3, NULL, $4)
      RETURNING *
    `,
    [jobId, attempt, status, retry_at],
  );

  return result.rows[0] ?? null;
};

// Creates the first QUEUED execution for a newly submitted job.
export const newInitialExecution = async (
  jobId: string,
  attempt: number,
  retry_at: Date | null,
  status: 'SCHEDULED' | 'QUEUED' = 'SCHEDULED',
) => {
  const result = await pool.query(
    `
      INSERT INTO executions (
        job_id,
        attempt,
        status,
        started_at,
        retry_at
      )
      VALUES ($1, $2, $3, NULL, $4)
      RETURNING *
    `,
    [jobId, attempt, status, retry_at],
  );

  return result.rows[0] ?? null;
};

// Marks an execution as FAILED with its error message.
export const failedExecution = async (
  client: PoolClient,
  executionId: string,
  errorMessage: string,
) => {
  const result = await client.query(
    `
      UPDATE executions
      SET
        status = 'FAILED',
        error = $2,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `,
    [executionId, errorMessage],
  );

  return result.rows[0];
};

// Marks an execution as COMPLETED.
export const successExecution = async (client: PoolClient, executionId: string) => {
  const result = await client.query(
    `
      UPDATE executions
      SET
        status = 'COMPLETED',
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `,
    [executionId],
  );

  return result.rows[0];
};

// Finds an execution by its ID.
export const getExecutionById = async (executionId: string) => {
  const result = await pool.query(
    `
      SELECT *
      FROM executions
      WHERE id = $1
    `,
    [executionId],
  );

  return result.rows[0] ?? null;
};

// Locks an execution row so its state can be safely checked or changed inside a transaction.
export const getExecutionByIdForUpdate = async (client: PoolClient, executionId: string) => {
  const result = await client.query(
    `
      SELECT *
      FROM executions
      WHERE id = $1
      FOR UPDATE
    `,
    [executionId],
  );

  return result.rows[0] ?? null;
};

// Lists all executions of a job ordered by attempt number.
export const getExecutionsByJobId = async (jobId: string) => {
  const result = await pool.query(
    `
      SELECT *
      FROM executions
      WHERE job_id = $1
      ORDER BY attempt ASC
    `,
    [jobId],
  );

  return result.rows;
};

// Marks an execution as RUNNING and records its start time.
export const startExecution = async (executionId: string) => {
  const result = await pool.query(
    `
      UPDATE executions
      SET
        status = 'RUNNING',
        started_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [executionId],
  );

  return result.rows[0];
};

// Marks an execution as TIMED_OUT when its handler exceeds the execution timeout.
export const timedOutExecution = async (client: PoolClient, executionId: string) => {
  const result = await client.query(
    `
      UPDATE executions
      SET
        status = 'TIMED_OUT',
        updated_at = NOW(),
        completed_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [executionId],
  );

  return result.rows[0];
};

// Marks a RUNNING execution as WORKER_CRASHED after its lease expired.
export const markWorkerCrashed = async (client: PoolClient, executionId: string) => {
  const result = await client.query(
    `
      UPDATE executions
      SET
        status = 'WORKER_CRASHED',
        updated_at = NOW(),
        completed_at = NOW()
      WHERE id = $1
        AND status = 'RUNNING'
      RETURNING *;
    `,
    [executionId],
  );

  return result.rows[0] ?? null;
};
