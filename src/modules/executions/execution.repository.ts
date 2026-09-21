import { pool } from '../../infrastructure/database/pool.js';

export interface JobForExecution {
  id: string;
}

export const newExecution = async (data: JobForExecution) => {
  const result = await pool.query(
    `
      INSERT INTO executions (
        job_id,
        status,
        started_at
      )
      VALUES (
        $1,
        'RUNNING',
        NOW()
      )
      RETURNING *;
    `,
    [data.id],
  );

  return result.rows[0];
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
