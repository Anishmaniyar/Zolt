import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { pool } from '../src/infrastructure/database/pool.js';
import {
  acquireExecutionLease,
  findLeaseByExecutionId,
} from '../src/modules/leases/leases.repository.js';

const LEASE_DURATION_MS = 60000;

describe('Lease acquisition', () => {
  const createdJobIds: string[] = [];

  const createExecution = async (status = 'QUEUED'): Promise<string> => {
    const jobResult = await pool.query(
      `
        INSERT INTO jobs (
          title, type, schedule_type, payload, run_at, max_attempts, status
        )
        VALUES ('Lease Test Job', 'SEND_EMAIL', 'ONCE', '{}', NOW(), 2, 'QUEUED')
        RETURNING id
      `,
    );
    const jobId: string = jobResult.rows[0].id;
    createdJobIds.push(jobId);

    const executionResult = await pool.query(
      `INSERT INTO executions (job_id, attempt, status)
       VALUES ($1, 1, $2)
       RETURNING id`,
      [jobId, status],
    );

    return executionResult.rows[0].id;
  };

  const createExpiredLease = async (executionId: string, workerId: string) => {
    await pool.query(
      `INSERT INTO leases (execution_id, worker_id, lease_expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 minute')`,
      [executionId, workerId],
    );
  };

  afterEach(async () => {
    for (const jobId of createdJobIds.splice(0)) {
      await pool.query(
        `DELETE FROM leases WHERE execution_id IN (SELECT id FROM executions WHERE job_id = $1)`,
        [jobId],
      );
      await pool.query(`DELETE FROM executions WHERE job_id = $1`, [jobId]);
      await pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('acquires a lease when the execution is QUEUED and has no lease', async () => {
    const executionId = await createExecution('QUEUED');

    const lease = await acquireExecutionLease(executionId, 'worker-a', LEASE_DURATION_MS);

    expect(lease).not.toBeNull();
    expect(lease.execution_id).toBe(executionId);
    expect(lease.worker_id).toBe('worker-a');
    expect(new Date(lease.lease_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects acquisition when another worker holds a valid lease', async () => {
    const executionId = await createExecution('QUEUED');
    await acquireExecutionLease(executionId, 'worker-a', LEASE_DURATION_MS);

    const lease = await acquireExecutionLease(executionId, 'worker-b', LEASE_DURATION_MS);

    expect(lease).toBeNull();
    expect((await findLeaseByExecutionId(executionId)).worker_id).toBe('worker-a');
  });

  it('acquires a lease when the existing lease has expired', async () => {
    const executionId = await createExecution('QUEUED');
    await createExpiredLease(executionId, 'worker-a');

    const lease = await acquireExecutionLease(executionId, 'worker-b', LEASE_DURATION_MS);

    expect(lease).not.toBeNull();
    expect(lease.worker_id).toBe('worker-b');
    expect(new Date(lease.lease_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects acquisition when the execution is not QUEUED', async () => {
    const executionId = await createExecution('RUNNING');

    const lease = await acquireExecutionLease(executionId, 'worker-a', LEASE_DURATION_MS);

    expect(lease).toBeNull();
    expect(await findLeaseByExecutionId(executionId)).toBeNull();
  });

  it('throws when the execution does not exist', async () => {
    await expect(
      acquireExecutionLease('00000000-0000-0000-0000-000000000000', 'worker-a', LEASE_DURATION_MS),
    ).rejects.toThrow();
  });

  it('grants exactly one winner under concurrent acquisition', async () => {
    const executionId = await createExecution('QUEUED');

    const [first, second] = await Promise.all([
      acquireExecutionLease(executionId, 'worker-a', LEASE_DURATION_MS),
      acquireExecutionLease(executionId, 'worker-b', LEASE_DURATION_MS),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await findLeaseByExecutionId(executionId)).not.toBeNull();
  });
});
