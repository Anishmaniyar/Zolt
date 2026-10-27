// Worker claim concurrency test.
//
// How it works:
//   Two `executeExistingExecution` calls are started against the same QUEUED
//   execution, simulating two BullMQ workers that received a duplicate
//   delivery. The handler is held open by a deferred so both calls overlap.
//   Postgres row locks in `acquireExecutionLease` must let exactly one worker
//   acquire the lease; the other returns false without invoking the handler.
//
// Covered:
//   T2  duplicate delivery of execute-execution, active-lease rejection, and
//   exactly-once terminal completion for one execution.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { handlerRegistry } from '../src/handlers/handler.registry.js';
import { executeExistingExecution } from '../src/modules/executions/execution.service.js';
import { jobsTotalFinalState } from '../src/shared/metrics/jobs.metrics.js';
import { deferred, waitFor } from './helpers/async.js';
import {
  closeTestPool,
  deleteJobCascade,
  getExecution,
  getIdempotency,
  getJob,
} from './helpers/db.js';
import { createExecutableJob, createLease } from './helpers/fixtures.js';
import { counterValue } from './helpers/metrics.js';

describe('Worker concurrency', () => {
  const createdJobIds: string[] = [];

  afterEach(async () => {
    for (const jobId of createdJobIds.splice(0)) {
      await deleteJobCascade(jobId);
    }

    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('lets exactly one of two overlapping workers run a duplicate execution delivery', async () => {
    const { job, execution } = await createExecutableJob({
      title: 'Worker Concurrency Duplicate',
      maxAttempts: 1,
    });
    createdJobIds.push(job.id);

    const before = await counterValue(jobsTotalFinalState, {
      type: job.type,
      schedule_type: job.schedule_type,
      status: 'COMPLETED',
    });

    const handlerGate = deferred<void>();
    const handler = vi
      .spyOn(handlerRegistry, 'SEND_EMAIL')
      .mockImplementation(() => handlerGate.promise);

    const first = executeExistingExecution(execution.id, 'worker-a');
    const second = executeExistingExecution(execution.id, 'worker-b');

    await waitFor(() => handler.mock.calls.length === 1);

    // Hold the winner inside the handler while the loser has already run its
    // lease/idempotency checks. Then release the winner.
    handlerGate.resolve();

    const results = await Promise.all([first, second]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === false)).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);

    expect((await getExecution(execution.id)).status).toBe('COMPLETED');
    expect((await getJob(job.id)).status).toBe('COMPLETED');
    expect((await getIdempotency(job.id)).status).toBe('COMPLETED');

    expect(
      await counterValue(jobsTotalFinalState, {
        type: job.type,
        schedule_type: job.schedule_type,
        status: 'COMPLETED',
      }),
    ).toBe(before + 1);
  });

  it('rejects a worker while another worker holds a non-expired lease', async () => {
    const { job, execution } = await createExecutableJob({
      title: 'Worker Concurrency Active Lease',
      maxAttempts: 1,
    });
    createdJobIds.push(job.id);

    await createLease(execution.id, { workerId: 'lease-owner', expiresInMs: 60_000 });

    const handler = vi.spyOn(handlerRegistry, 'SEND_EMAIL');

    const result = await executeExistingExecution(execution.id, 'worker-b');

    expect(result).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect((await getExecution(execution.id)).status).toBe('QUEUED');
    expect((await getIdempotency(job.id)).status).toBe('PENDING');
  });

  it('does not run the handler twice when the same execution is delivered sequentially', async () => {
    const { job, execution } = await createExecutableJob({
      title: 'Worker Concurrency Sequential',
      maxAttempts: 1,
    });
    createdJobIds.push(job.id);

    const handler = vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockResolvedValue(undefined);

    const first = await executeExistingExecution(execution.id, 'worker-a');
    const second = await executeExistingExecution(execution.id, 'worker-b');

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
