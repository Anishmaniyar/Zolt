import type { PoolClient } from 'pg';
import { pool } from '../../infrastructure/database/pool.js';

// Writes a PENDING outbox row so a claimed job is later published to BullMQ.
export const createJobOutbox = async (client: PoolClient, jobId: string) => {
  const query = `
    INSERT INTO outbox (job_id, status)
    VALUES ($1, 'PENDING')
    RETURNING *
  `;

  const result = await client.query(query, [jobId]);

  return result.rows[0];
};

// Writes a PENDING outbox row so a claimed execution is later published to BullMQ.
export const createExecutionOutbox = async (client: PoolClient, executionId: string) => {
  const query = `
    INSERT INTO outbox (execution_id, status)
    VALUES ($1, 'PENDING')
    RETURNING *
  `;

  const result = await client.query(query, [executionId]);

  return result.rows[0];
};

// Atomically claims PENDING outbox rows so only one scheduler publishes each row.
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

// Returns the current PENDING backlog and the age of its oldest row.
export const getPendingOutboxStats = async () => {
  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS count,
        MIN(created_at) AS oldest_created_at
      FROM outbox
      WHERE status = 'PENDING'
    `,
  );

  return {
    count: Number(result.rows[0]?.count ?? 0),
    oldest_created_at: (result.rows[0]?.oldest_created_at ?? null) as Date | null,
  };
};

// Deletes PUBLISHED rows older than the retention window.
// PENDING rows are never touched: they still have to be published.
export const deletePublishedOutboxBefore = async (retentionMs: number) => {
  const result = await pool.query(
    `
      DELETE FROM outbox
      WHERE status = 'PUBLISHED'
        AND published_at IS NOT NULL
        AND published_at < NOW() - ($1 * INTERVAL '1 millisecond')
    `,
    [retentionMs],
  );

  return result.rowCount ?? 0;
};

// Returns claimed outbox rows to PENDING after a failed BullMQ enqueue so the next tick retries them.
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
