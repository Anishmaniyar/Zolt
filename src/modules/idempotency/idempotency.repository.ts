import { pool } from '../../infrastructure/database/pool.js';
import AppError from '../../shared/errors/appError.js';
import type { PoolClient } from 'pg';

export type IdempotencyClaimResult = 'CLAIMED' | 'ALREADY_PROCESSING' | 'ALREADY_COMPLETED';

// Finds the idempotency record guarding a job.
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

// Locks an idempotency record so its state can be safely checked or changed inside a transaction.
export const getByJobIdForUpdate = async (client: PoolClient, jobId: string) => {
  const result = await client.query(
    `
      SELECT *
      FROM idempotency_records
      WHERE job_id = $1
      FOR UPDATE
    `,
    [jobId],
  );

  return result.rows[0] ?? null;
};

// Atomically claims a PENDING idempotency record for processing, or reports its existing state.
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

// Marks an idempotency record as COMPLETED after its handler succeeds.
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

// Resets a PROCESSING record to PENDING so a scheduled retry can claim it again.
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

// Finds PROCESSING records stuck past the timeout that may need recovery.
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

// Resets a stale PROCESSING record to PENDING so it can be claimed again.
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
