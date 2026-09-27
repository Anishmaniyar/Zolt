import type { PoolClient } from 'pg';
import { pool } from '../../infrastructure/database/pool.js';

export const createJobOutbox = async (client: PoolClient, jobId: string) => {
  const query = `
    INSERT INTO outbox (job_id, status)
    VALUES ($1, 'PENDING')
    RETURNING *
  `;

  const result = await client.query(query, [jobId]);

  return result.rows[0];
};

export const createExecutionOutbox = async (client: PoolClient, executionId: string) => {
  const query = `
    INSERT INTO outbox (execution_id, status)
    VALUES ($1, 'PENDING')
    RETURNING *
  `;

  const result = await client.query(query, [executionId]);

  return result.rows[0];
};

export const getPendingOutbox = async (limit: number) => {
  const result = await pool.query(
    `
      SELECT *
      FROM outbox
      WHERE status = 'PENDING'
      ORDER BY created_at
      LIMIT $1
    `,
    [limit],
  );

  return result.rows;
};

export const markPublished = async (outboxId: string) => {
  const result = await pool.query(
    `
      UPDATE outbox
      SET
        status = 'PUBLISHED',
        published_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [outboxId],
  );

  return result.rows[0];
};
