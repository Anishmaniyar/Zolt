import { pool } from '../../infrastructure/database/pool.js';

export interface JobForExecution {
  id: string;
}

export const newExecution = async (job: JobForExecution, attempt: number) => {
  const result = await pool.query(
    `
      INSERT INTO executions (
        job_id,
        attempt,
        status,
        started_at
      )
      VALUES ($1, $2, 'RUNNING', NOW())
      RETURNING *
    `,
    [job.id, attempt],
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
