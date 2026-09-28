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

export const claimPendingOutbox = async (limit: number) => {
  // Atomic claim: only one scheduler wins each row thanks to
  // FOR UPDATE SKIP LOCKED. Row moves PENDING -> PUBLISHED here,
  // before the Redis enqueue, so a second scheduler can never
  // SELECT the same row.
  const result = await pool.query(
    `
      UPDATE outbox
      SET
        status = 'PUBLISHED',
        published_at = NOW(),
        updated_at = NOW()
      WHERE id IN (
        SELECT id
        FROM outbox
        WHERE status = 'PENDING'
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `,
    [limit],
  );

  return result.rows;
};

export const resetOutboxToPending = async (outboxIds: string[]) => {
  // Called only when the Redis enqueue AFTER the claim throws,
  // so the next tick can retry. Without this a crash between
  // claim and enqueue would lose the message.
  if (outboxIds.length === 0) return [];

  const result = await pool.query(
    `
      UPDATE outbox
      SET
        status = 'PENDING',
        published_at = NULL,
        updated_at = NOW()
      WHERE id = ANY($1)
        AND status = 'PUBLISHED'
      RETURNING *
    `,
    [outboxIds],
  );

  return result.rows;
};
