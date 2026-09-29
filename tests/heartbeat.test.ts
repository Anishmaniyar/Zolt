import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { pool } from '../src/infrastructure/database/pool.js';
import {
  acquireExecutionLease,
  findExpiredLeases,
  findLeaseByExecutionId,
} from '../src/modules/leases/leases.repository.js';
import {
  registerExecution,
  startHeartbeat,
  stopHeartbeat,
  unregisterExecution,
} from '../src/workers/heartbeat.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Heartbeat and expiration detection', () => {
  const createdJobIds: string[] = [];
  const registeredExecutionIds: string[] = [];

  const createExecution = async (): Promise<string> => {
    const jobResult = await pool.query(
      `
        INSERT INTO jobs (
          title, type, schedule_type, payload, run_at, max_attempts, status
        )
        VALUES ('Heartbeat Test Job', 'SEND_EMAIL', 'ONCE', '{}', NOW(), 2, 'QUEUED')
        RETURNING id
      `,
    );
    const jobId: string = jobResult.rows[0].id;
    createdJobIds.push(jobId);

    const executionResult = await pool.query(
      `INSERT INTO executions (job_id, attempt, status)
       VALUES ($1, 1, 'QUEUED')
       RETURNING id`,
      [jobId],
    );

    return executionResult.rows[0].id;
  };

  const track = (executionId: string, workerId: string) => {
    registerExecution(executionId, workerId);
    registeredExecutionIds.push(executionId);
  };

  afterEach(async () => {
    stopHeartbeat();

    for (const executionId of registeredExecutionIds.splice(0)) {
      unregisterExecution(executionId);
    }

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

  it('heartbeat keeps extending the lease while the execution is active', async () => {
    const executionId = await createExecution();
    const initial = await acquireExecutionLease(executionId, 'worker-a', 5000);
    track(executionId, 'worker-a');

    startHeartbeat(50);
    await sleep(250);

    const renewed = await findLeaseByExecutionId(executionId);
    expect(new Date(renewed.lease_expires_at).getTime()).toBeGreaterThan(
      new Date(initial.lease_expires_at).getTime(),
    );
  });

  it('heartbeat renews every active execution', async () => {
    const executionIds = [await createExecution(), await createExecution(), await createExecution()];

    for (const executionId of executionIds) {
      await acquireExecutionLease(executionId, 'worker-a', 5000);
      track(executionId, 'worker-a');
    }

    const before = await findLeaseByExecutionId(executionIds[0]);

    startHeartbeat(50);
    await sleep(250);

    for (const executionId of executionIds) {
      const renewed = await findLeaseByExecutionId(executionId);
      expect(new Date(renewed.lease_expires_at).getTime()).toBeGreaterThan(
        new Date(before.lease_expires_at).getTime(),
      );
    }
  });

  it('unregistered executions are no longer renewed', async () => {
    const executionId = await createExecution();
    await acquireExecutionLease(executionId, 'worker-a', 5000);
    track(executionId, 'worker-a');

    startHeartbeat(50);
    await sleep(150);

    unregisterExecution(executionId);
    registeredExecutionIds.splice(registeredExecutionIds.indexOf(executionId), 1);
    const snapshot = (await findLeaseByExecutionId(executionId)).lease_expires_at;

    await sleep(200);

    const after = (await findLeaseByExecutionId(executionId)).lease_expires_at;
    expect(new Date(after).getTime()).toBe(new Date(snapshot).getTime());
  });

  it('an unrenewed lease expires and is detected', async () => {
    const executionId = await createExecution();

    // Short lease, heartbeat never started: simulated worker death.
    await acquireExecutionLease(executionId, 'worker-a', 300);
    await sleep(500);

    const expired = await findExpiredLeases();
    expect(expired.map((lease) => lease.execution_id)).toContain(executionId);
  });
});
