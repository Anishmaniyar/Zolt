import { pool } from '../../infrastructure/database/pool.js';
import AppError from '../../shared/errors/appError.js';
import type { PoolClient } from 'pg';

export type IdempotencyClaimResult = 'CLAIMED' | 'ALREADY_PROCESSING' | 'ALREADY_COMPLETED';

/**
 * Fetches the idempotency record for a job. The key lives on the
 * idempotency record, not on the job, so it is resolved here.
 */
export const getByJobId = async (jobId: string) => {
  const result = await pool.query(
    `
      SELECT *
      FROM idempotency_records
      WHERE job_id = $1
    `,
    [jobId],
  );

  return result.rows[0] ?? null;
};

/**
 * Atomically transitions PENDING -> PROCESSING.
 *
 * The status check happens inside the UPDATE statement, so PostgreSQL
 * guarantees only one caller can win the claim for a given key. Losers
 * get rowCount = 0 and then inspect the record to learn why.
 */
export const claimIdempotency = async (idempotencyKey: string): Promise<IdempotencyClaimResult> => {
  const result = await pool.query(
    `
      UPDATE idempotency_records
      SET status = 'PROCESSING', processing_started_at = NOW(), updated_at = NOW()
      WHERE idempotency_key = $1
        AND status = 'PENDING'
      RETURNING id
    `,
    [idempotencyKey],
  );

  if (result.rowCount === 1) {
    return 'CLAIMED';
  }

  const statusResult = await pool.query(
    `
      SELECT status
      FROM idempotency_records
      WHERE idempotency_key = $1
    `,
    [idempotencyKey],
  );

  if (statusResult.rowCount === 0) {
    throw new AppError(`Idempotency record not found for key ${idempotencyKey}`, 500);
  }

  const status = statusResult.rows[0]?.status;

  if (status === 'COMPLETED') {
    return 'ALREADY_COMPLETED';
  }

  return 'ALREADY_PROCESSING';
};

/**
 * Marks the record as COMPLETED once the handler has succeeded.
 */
export const completeIdempotency = async (
  client: PoolClient,
  idempotencyKey: string,
): Promise<void> => {
  const result = await client.query(
    `
      UPDATE idempotency_records
      SET status = 'COMPLETED', processing_started_at = NULL, updated_at = NOW()
      WHERE idempotency_key = $1
        AND status = 'PROCESSING'
    `,
    [idempotencyKey],
  );

  if (result.rowCount !== 1) {
    throw new AppError(`Unable to complete idempotency record ${idempotencyKey}`, 500);
  }
};

/**
 * Resets a claim to PENDING when the handler fails but attempts remain,
 * so the queued retry execution can claim the record again.
 */
export const resetToPending = async (client: PoolClient, idempotencyKey: string): Promise<void> => {
  const result = await client.query(
    `
      UPDATE idempotency_records
      SET status = 'PENDING', processing_started_at = NULL, updated_at = NOW()
      WHERE idempotency_key = $1
        AND status = 'PROCESSING'
    `,
    [idempotencyKey],
  );

  if (result.rowCount !== 1) {
    throw new AppError(`Unable to reset idempotency record ${idempotencyKey}`, 500);
  }
};

export const getStaleProcessingRecords = async (timeout: number) => {
  const result = await pool.query(
    `
      SELECT *
      FROM idempotency_records
      WHERE status = 'PROCESSING'
        AND processing_started_at < NOW() - ($1 * INTERVAL '1 millisecond')
    `,
    [timeout],
  );

  return result.rows;
};

/**
 * Resets a stale PROCESSING record to PENDING so it can be claimed again.
 *
 * The timeout check is repeated inside the UPDATE, so a record that was
 * freshly (re-)claimed between the SELECT and this UPDATE is not reset:
 * only rows still older than the timeout are touched. Returns the number
 * of rows reset (0 = lost the race, nothing to do).
 */
export const resetStaleProcessingRecord = async (recordId: string, timeoutMs: number) => {
  const result = await pool.query(
    `
      UPDATE idempotency_records
      SET status = 'PENDING', processing_started_at = NULL, updated_at = NOW()
      WHERE id = $1
        AND status = 'PROCESSING'
        AND processing_started_at < NOW() - ($2 * INTERVAL '1 millisecond')
    `,
    [recordId, timeoutMs],
  );

  return result.rowCount;
};
