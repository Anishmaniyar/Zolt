// Duplicate queue-delivery tests (T6) and the terminal-job overwrite guard (M3).
//
// How it works:
//   A duplicate delivery of the same BullMQ message is simulated by calling the
//   same worker entry point twice for the same job row. No scheduler or worker
//   process is needed, so these tests run even while development processes are
//   up.
//
// Covered:
//   M2  a duplicate execute-job delivery converges on the single attempt-1 row
//       while the attempt is running, and is refused once the job is terminal,
//   M3  a stale delivery for a CANCELLED or FAILED job cannot move the job or
//       run the handler; the stranded attempt is closed instead,
//   metric integrity: none of these paths double-counts zolt_jobs_final_total.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { handlerRegistry } from '../src/handlers/handler.registry.js';
import {
  createNewExecution,
  executeExistingExecution,
} from '../src/modules/executions/execution.service.js';
import { jobsTotal, jobsTotalFinalState } from '../src/shared/metrics/jobs.metrics.js';
import { deferred, waitFor } from './helpers/async.js';
import {
  closeTestPool,
  countExecutions,
  deleteJobCascade,
  getExecution,
  getExecutions,
  getIdempotency,
  getJob,
} from './helpers/db.js';
import { createExecution, createIdempotency, createJob } from './helpers/fixtures.js';
import { counterValue } from './helpers/metrics.js';

describe('Duplicate delivery', () => {
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

  it('converges on one execution row when the same execute-job message is delivered twice', async () => {
    const job = await createJob({
      title: 'Duplicate Execute Job',
      status: 'QUEUED',
      maxAttempts: 1,
    });
    createdJobIds.push(job.id);

    await createIdempotency(job.id, { status: 'PENDING' });

    const finalsBefore = await counterValue(jobsTotalFinalState, {
      type: job.type,
      schedule_type: job.schedule_type,
      status: 'COMPLETED',
    });
    const createdBefore = await counterValue(jobsTotal, {
      type: job.type,
      schedule_type: job.schedule_type,
    });

    const handlerGate = deferred<void>();
    const handler = vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockImplementation(() => handlerGate.promise);

    const jobForExecution = {
      id: job.id,
      title: job.title,
      type: job.type as 'SEND_EMAIL',
      schedule_type: job.schedule_type,
      status: job.status,
      payload: {},
      run_at: job.run_at,
      max_attempts: job.max_attempts,
    };

    // First delivery is held inside the handler while the second one arrives.
    const first = createNewExecution(jobForExecution, 'worker-a');
    await waitFor(() => handler.mock.calls.length === 1);

    const second = await createNewExecution(jobForExecution, 'worker-b');

    expect(second).toBe(false);

    handlerGate.resolve();
    expect(await first).toBe(true);

    const executions = await getExecutions(job.id);

    // The unique (job_id, attempt) constraint makes both deliveries share one
    // attempt row instead of inserting a second one.
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({ attempt: 1, status: 'COMPLETED' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect((await getJob(job.id)).status).toBe('COMPLETED');
    expect((await getIdempotency(job.id)).status).toBe('COMPLETED');
    expect(
      await counterValue(jobsTotalFinalState, {
        type: job.type,
        schedule_type: job.schedule_type,
        status: 'COMPLETED',
      }),
    ).toBe(finalsBefore + 1);
    expect(
      await counterValue(jobsTotal, { type: job.type, schedule_type: job.schedule_type }),
    ).toBe(createdBefore);
  });

  it('refuses a duplicate execute-job delivery once the job is already COMPLETED', async () => {
    const job = await createJob({
      title: 'Duplicate After Completion',
      status: 'COMPLETED',
      maxAttempts: 1,
    });
    createdJobIds.push(job.id);

    await createExecution(job.id, { status: 'COMPLETED', attempt: 1 });
    await createIdempotency(job.id, { status: 'COMPLETED' });

    const handler = vi.spyOn(handlerRegistry, 'SEND_EMAIL');
    const finalsBefore = await counterValue(jobsTotalFinalState, {
      type: job.type,
      schedule_type: job.schedule_type,
      status: 'COMPLETED',
    });

    const result = await createNewExecution(
      {
        id: job.id,
        title: job.title,
        type: job.type as 'SEND_EMAIL',
        schedule_type: job.schedule_type,
        status: job.status,
        payload: {},
        run_at: job.run_at,
        max_attempts: job.max_attempts,
      },
      'worker-a',
    );

    expect(result).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(await countExecutions(job.id)).toBe(1);
    expect((await getJob(job.id)).status).toBe('COMPLETED');

    // The refused delivery produced no terminal transition.
    expect(
      await counterValue(jobsTotalFinalState, {
        type: job.type,
        schedule_type: job.schedule_type,
        status: 'COMPLETED',
      }),
    ).toBe(finalsBefore);
  });

  it('closes a stranded attempt for a terminally FAILED job instead of re-running it', async () => {
    const job = await createJob({
      title: 'Stale Delivery After Failure',
      status: 'FAILED',
      maxAttempts: 1,
    });
    createdJobIds.push(job.id);

    const stranded = await createExecution(job.id, { status: 'QUEUED', attempt: 1 });
    await createIdempotency(job.id, { status: 'PROCESSING' });

    const handler = vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockResolvedValue(undefined);
    const finalsBefore = await counterValue(jobsTotalFinalState, { status: 'FAILED' });

    const result = await executeExistingExecution(stranded.id, 'worker-a');

    expect(result).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    const closed = await getExecution(stranded.id);
    expect(closed.status).toBe('FAILED');
    expect(closed.error).toBe('job_failed');

    // The job keeps its terminal state and the final counter is not incremented.
    expect((await getJob(job.id)).status).toBe('FAILED');
    expect(await counterValue(jobsTotalFinalState, { status: 'FAILED' })).toBe(finalsBefore);
  });

  it('keeps a CANCELLED job cancelled when a stale delivery arrives', async () => {
    const job = await createJob({
      title: 'Cancelled Then Delivered',
      status: 'CANCELLED',
      maxAttempts: 1,
    });
    createdJobIds.push(job.id);

    // A worker had already queued the attempt before the job was cancelled.
    const execution = await createExecution(job.id, { status: 'QUEUED', attempt: 1 });
    await createIdempotency(job.id, { status: 'PENDING' });

    const handler = vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockResolvedValue(undefined);
    const completedBefore = await counterValue(jobsTotalFinalState, {
      type: job.type,
      schedule_type: job.schedule_type,
      status: 'COMPLETED',
    });

    const result = await executeExistingExecution(execution.id, 'worker-a');

    expect(result).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    // successJob/failedJob exclude CANCELLED, so the terminal state survives and
    // the job never gets a second final-state count.
    expect((await getJob(job.id)).status).toBe('CANCELLED');
    expect((await getExecution(execution.id)).status).toBe('FAILED');
    expect((await getExecution(execution.id)).error).toBe('job_cancelled');
    expect(
      await counterValue(jobsTotalFinalState, {
        type: job.type,
        schedule_type: job.schedule_type,
        status: 'COMPLETED',
      }),
    ).toBe(completedBefore);
  });
});
