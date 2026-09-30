import { pool } from '../../infrastructure/database/pool.js';
import AppError from '../../shared/errors/appError.js';
import type { PoolClient } from 'pg';

// Acquires the lease for a QUEUED execution, or returns null when another worker validly owns it.
export const acquireExecutionLease = async (
  executionId: string,
  workerId: string,
  leaseDurationMs: number,
) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const executionResult = await client.query(
      `
        SELECT *
        FROM executions
        WHERE id = $1
        FOR UPDATE
      `,
      [executionId],
    );

    if (executionResult.rowCount === 0) {
      throw new AppError(`Execution ${executionId} not found`, 404);
    }

    if (executionResult.rows[0].status !== 'QUEUED') {
      await client.query('ROLLBACK');
      return null;
    }

    const leaseResult = await client.query(
      `
        SELECT *
        FROM leases
        WHERE execution_id = $1
        FOR UPDATE
      `,
      [executionId],
    );

    if (leaseResult.rowCount === 1 && new Date(leaseResult.rows[0].lease_expires_at) > new Date()) {
      await client.query('ROLLBACK');
      return null;
    }

    let lease;

    if (leaseResult.rowCount === 1) {
      const updateResult = await client.query(
        `
          UPDATE leases
          SET worker_id = $2,
            lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
            updated_at = NOW()
          WHERE execution_id = $1
          RETURNING *
        `,
        [executionId, workerId, leaseDurationMs],
      );

      lease = updateResult.rows[0];
    } else {
      const insertResult = await client.query(
        `
          INSERT INTO leases (
            execution_id,
            worker_id,
            lease_expires_at
          )
          VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'))
          RETURNING *
        `,
        [executionId, workerId, leaseDurationMs],
      );

      lease = insertResult.rows[0];
    }

    await client.query('COMMIT');

    return lease;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Finds the lease holding an execution, if one exists.
export const findLeaseByExecutionId = async (executionId: string) => {
  const result = await pool.query(
    `
      SELECT *
      FROM leases
      WHERE execution_id = $1
    `,
    [executionId],
  );

  return result.rows[0] ?? null;
};

// Locks a lease row so its expiry can be safely re-checked inside a recovery transaction.
export const findLeaseByExecutionIdForUpdate = async (client: PoolClient, executionId: string) => {
  const result = await client.query(
    `
      SELECT *
      FROM leases
      WHERE execution_id = $1
      FOR UPDATE
    `,
    [executionId],
  );

  return result.rows[0] ?? null;
};

// Renews the lease if this worker still owns the execution and the lease has not expired.
export const renewLease = async (
  executionId: string,
  workerId: string,
  leaseDurationMs: number,
) => {
  const result = await pool.query(
    `
      UPDATE leases
      SET
        lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE execution_id = $1
        AND worker_id = $2
        AND lease_expires_at > NOW()
      RETURNING *
    `,
    [executionId, workerId, leaseDurationMs],
  );

  return result.rows[0] ?? null;
};

// Finds leases whose expiry has passed along with their execution status.
export const findExpiredLeases = async () => {
  const result = await pool.query(
    `
      SELECT
        leases.id AS lease_id,
        leases.execution_id,
        leases.worker_id,
        leases.lease_expires_at,
        executions.status AS execution_status
      FROM leases
      JOIN executions ON executions.id = leases.execution_id
      WHERE leases.lease_expires_at <= NOW()
      ORDER BY leases.lease_expires_at ASC
    `,
  );

  return result.rows;
};
