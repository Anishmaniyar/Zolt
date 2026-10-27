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

// Returns the attempt-1 execution of a job, creating it only when it is
// missing. The unique (job_id, attempt) constraint makes a duplicate queue
// delivery converge on the existing attempt instead of inserting a second one.
// `created` tells the caller whether this call inserted the row.
export const getOrCreateInitialExecution = async (jobId: string) => {
  const inserted = await pool.query(
    `
      INSERT INTO executions (
        job_id,
        attempt,
        status,
        started_at,
        retry_at
      )
      VALUES ($1, 1, 'QUEUED', NULL, NULL)
      ON CONFLICT (job_id, attempt) DO NOTHING
      RETURNING *, TRUE AS created
    `,
    [jobId],
  );

  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await pool.query(
    `
      SELECT *, FALSE AS created
      FROM executions
      WHERE job_id = $1
        AND attempt = 1
    `,
    [jobId],
  );

  return existing.rows[0] ?? null;
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
// `completedAt` is the lease expiry, i.e. the last moment the worker was known
// to be alive. Using NOW() here would make the recorded duration measure
// recovery detection delay instead of the attempt.
export const markWorkerCrashed = async (
  client: PoolClient,
  executionId: string,
  completedAt: Date,
) => {
  const result = await client.query(
    `
      UPDATE executions
      SET
        status = 'WORKER_CRASHED',
        updated_at = NOW(),
        completed_at = $2
      WHERE id = $1
        AND status = 'RUNNING'
      RETURNING *,
        (SELECT type FROM jobs WHERE jobs.id = executions.job_id) AS job_type;
    `,
    [executionId, completedAt],
  );

  return result.rows[0] ?? null;
};
