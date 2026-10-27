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
import { workerActiveExecutions } from '../src/shared/metrics/worker.metrics.js';

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

  const getActiveCount = async () => {
    const { values } = await workerActiveExecutions.get();

    return values[0]?.value ?? 0;
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

  it('active execution gauge follows registration exactly once', async () => {
    const executionId = await createExecution();
    const before = await getActiveCount();

    track(executionId, 'worker-a');
    expect(await getActiveCount()).toBe(before + 1);

    // Re-registering the same execution must not double count.
    registerExecution(executionId, 'worker-a');
    expect(await getActiveCount()).toBe(before + 1);

    unregisterExecution(executionId);
    registeredExecutionIds.splice(registeredExecutionIds.indexOf(executionId), 1);

    expect(await getActiveCount()).toBe(before);
  });

  it('an unrenewed lease expires and is detected', async () => {
    const executionId = await createExecution();

    // Short lease, heartbeat never started: simulated worker death while the
    // attempt was running.
    await acquireExecutionLease(executionId, 'worker-a', 300);
    await pool.query(`UPDATE executions SET status = 'RUNNING', started_at = NOW() WHERE id = $1`, [
      executionId,
    ]);
    await sleep(500);

    const expired = await findExpiredLeases();
    expect(expired.map((lease) => lease.execution_id)).toContain(executionId);
  });

  it('does not report the lease of an attempt that never started running', async () => {
    const executionId = await createExecution();

    // The worker died between acquiring the lease and starting the attempt.
    // Recovery only owns RUNNING executions; a QUEUED row is reconciliation's
    // job, so it must not show up as an expired lease on every tick.
    await acquireExecutionLease(executionId, 'worker-a', 300);
    await sleep(500);

    const expired = await findExpiredLeases();
    expect(expired.map((lease) => lease.execution_id)).not.toContain(executionId);
  });
});
