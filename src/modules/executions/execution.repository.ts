import { pool } from '../../infrastructure/database/pool.js';

export const newExecution = async (
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

export const failedExecution = async (executionId: string, errorMessage: string) => {
  const result = await pool.query(
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

export const successExecution = async (executionId: string) => {
  const result = await pool.query(
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
