import { pool } from '../../infrastructure/database/pool.js';

// Finds QUEUED jobs old enough to be reconciliation suspects.
// Caller passes batch + minAgeMs so config stays in the service layer.
export async function getReconciliationCandidatesForJobs(batch: number, minAgeMs: number) {
  const result = await pool.query(
    `
      SELECT *
      FROM jobs
      WHERE status = 'QUEUED'
        AND updated_at < NOW() - ($2 * INTERVAL '1 millisecond')
      ORDER BY updated_at ASC
      LIMIT $1
    `,
    [batch, minAgeMs],
  );

  return result.rows;
}

// Finds QUEUED executions old enough to be reconciliation suspects.
export async function getReconciliationCandidatesForExecutions(batch: number, minAgeMs: number) {
  const result = await pool.query(
    `
      SELECT *
      FROM executions
      WHERE status = 'QUEUED'
        AND updated_at < NOW() - ($2 * INTERVAL '1 millisecond')
      ORDER BY updated_at ASC
      LIMIT $1
    `,
    [batch, minAgeMs],
  );

  return result.rows;
}
