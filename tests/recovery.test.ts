import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { pool } from '../src/infrastructure/database/pool.js';
import { recoverExpiredExecution } from '../src/modules/executions/execution.service.js';
import { acquireExecutionLease } from '../src/modules/leases/leases.repository.js';

interface FixtureOptions {
  executionStatus?: string;
  idempotencyStatus?: 'PROCESSING' | 'COMPLETED' | null;
  lease?: 'expired' | 'valid' | 'none';
}

describe('Worker-crash recovery', () => {
  const createdJobIds: string[] = [];

  const createFixture = async (options: FixtureOptions = {}) => {
    const { executionStatus = 'RUNNING', idempotencyStatus = 'PROCESSING', lease = 'expired' } =
      options;

    const jobResult = await pool.query(
      `
        INSERT INTO jobs (
          title, type, schedule_type, payload, run_at, max_attempts, status
        )
        VALUES ('Recovery Test Job', 'SEND_EMAIL', 'ONCE', '{}', NOW(), 3, 'RUNNING')
        RETURNING id
      `,
    );
    const jobId: string = jobResult.rows[0].id;
    createdJobIds.push(jobId);

    const executionResult = await pool.query(
      `INSERT INTO executions (job_id, attempt, status, started_at)
       VALUES ($1, 1, $2, NOW())
       RETURNING id`,
      [jobId, executionStatus],
    );
    const executionId: string = executionResult.rows[0].id;

    let idempotencyKey: string | null = null;

    if (idempotencyStatus !== null) {
      const idempotencyResult = await pool.query(
        `INSERT INTO idempotency_records (job_id, idempotency_key, status, processing_started_at)
         VALUES ($1, $2, $3, $4)
         RETURNING idempotency_key`,
        [
          jobId,
          crypto.randomUUID(),
          idempotencyStatus,
          idempotencyStatus === 'PROCESSING' ? new Date() : null,
        ],
      );
      idempotencyKey = idempotencyResult.rows[0].idempotency_key;
    }

    if (lease !== 'none') {
      await pool.query(
        `INSERT INTO leases (execution_id, worker_id, lease_expires_at)
         VALUES ($1, 'worker-a', ${lease === 'expired' ? "NOW() - INTERVAL '1 minute'" : "NOW() + INTERVAL '5 minutes'"})`,
        [executionId],
      );
    }

    return { jobId, executionId, idempotencyKey };
  };

  const getExecution = async (id: string) => {
    const result = await pool.query(`SELECT * FROM executions WHERE id = $1`, [id]);
    return result.rows[0];
  };

  const getJob = async (id: string) => {
    const result = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
    return result.rows[0];
  };

  const getIdempotency = async (jobId: string) => {
    const result = await pool.query(`SELECT * FROM idempotency_records WHERE job_id = $1`, [
      jobId,
    ]);
    return result.rows[0];
  };

  const countExecutions = async (jobId: string) => {
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM executions WHERE job_id = $1`, [
      jobId,
    ]);
    return result.rows[0].n as number;
  };

  const getExecutionOutbox = async (executionId: string) => {
    const result = await pool.query(`SELECT * FROM outbox WHERE execution_id = $1`, [executionId]);
    return result.rows[0] ?? null;
  };

  afterEach(async () => {
    for (const jobId of createdJobIds.splice(0)) {
      await pool.query(
        `DELETE FROM outbox WHERE execution_id IN (SELECT id FROM executions WHERE job_id = $1)`,
        [jobId],
      );
      await pool.query(
        `DELETE FROM leases WHERE execution_id IN (SELECT id FROM executions WHERE job_id = $1)`,
        [jobId],
      );
      await pool.query(`DELETE FROM executions WHERE job_id = $1`, [jobId]);
      await pool.query(`DELETE FROM idempotency_records WHERE job_id = $1`, [jobId]);
      await pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('crashed execution with PROCESSING idempotency creates a retry and outbox record', async () => {
    const { jobId, executionId } = await createFixture();

    const result = await recoverExpiredExecution(executionId);

    expect(result).toBe(true);
    expect((await getExecution(executionId)).status).toBe('WORKER_CRASHED');

    const retries = await pool.query(
      `SELECT * FROM executions WHERE job_id = $1 ORDER BY attempt ASC`,
      [jobId],
    );
    expect(retries.rows).toHaveLength(2);

    const retry = retries.rows[1];
    expect(retry.attempt).toBe(2);
    expect(retry.status).toBe('SCHEDULED');
    expect(retry.retry_at).not.toBeNull();

    const outbox = await getExecutionOutbox(retry.id);
    expect(outbox).not.toBeNull();
    expect(outbox.status).toBe('PENDING');

    // Crash recovery leaves the job running and the claim untouched.
    expect((await getJob(jobId)).status).toBe('RUNNING');
    expect((await getIdempotency(jobId)).status).toBe('PROCESSING');

    // The expired lease is kept as ownership history.
    const lease = await pool.query(`SELECT * FROM leases WHERE execution_id = $1`, [executionId]);
    expect(lease.rows).toHaveLength(1);
    expect(lease.rows[0].worker_id).toBe('worker-a');
  });

  it('expired lease with COMPLETED idempotency finalizes execution and job', async () => {
    const { jobId, executionId } = await createFixture({ idempotencyStatus: 'COMPLETED' });

    const result = await recoverExpiredExecution(executionId);

    expect(result).toBe(true);
    expect((await getExecution(executionId)).status).toBe('COMPLETED');
    expect((await getJob(jobId)).status).toBe('COMPLETED');
    expect(await countExecutions(jobId)).toBe(1);
  });

  it('missing idempotency record recovers nothing', async () => {
    const { jobId, executionId } = await createFixture({ idempotencyStatus: null });

    const result = await recoverExpiredExecution(executionId);

    expect(result).toBe(false);
    expect((await getExecution(executionId)).status).toBe('RUNNING');
    expect(await countExecutions(jobId)).toBe(1);
  });

  it('valid lease is left alone', async () => {
    const { jobId, executionId } = await createFixture({ lease: 'valid' });

    const result = await recoverExpiredExecution(executionId);

    expect(result).toBe(false);
    expect((await getExecution(executionId)).status).toBe('RUNNING');
    expect(await countExecutions(jobId)).toBe(1);
  });

  it('non-RUNNING execution is left alone', async () => {
    const { jobId, executionId } = await createFixture({ executionStatus: 'WORKER_CRASHED' });

    const result = await recoverExpiredExecution(executionId);

    expect(result).toBe(false);
    expect((await getExecution(executionId)).status).toBe('WORKER_CRASHED');
    expect(await countExecutions(jobId)).toBe(1);
  });

  it('recovered execution is picked up by a new worker lease', async () => {
    const { jobId, executionId } = await createFixture();

    await recoverExpiredExecution(executionId);

    const retry = (
      await pool.query(`SELECT * FROM executions WHERE job_id = $1 AND attempt = 2`, [jobId])
    ).rows[0];

    // Simulate the scheduler claiming the retry when due.
    await pool.query(
      `UPDATE executions SET status = 'QUEUED', retry_at = NOW() WHERE id = $1`,
      [retry.id],
    );

    const lease = await acquireExecutionLease(retry.id, 'worker-b', 60000);

    expect(lease).not.toBeNull();
    expect(lease.worker_id).toBe('worker-b');
  });
});
