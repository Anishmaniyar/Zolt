// Recovery/scheduler-order integration tests.
//
// How it works:
//   Fixtures create a RUNNING execution with an expired lease and a PROCESSING
//   idempotency claim, which is the state left behind by a crashed worker. The
//   helpers then run the scheduler's stale-idempotency and expired-lease steps
//   in the same order as the real tick.
//
//   These tests encode the intended behaviour of the recovery path, so they
//   fail if recovery goes back to racing the stale-claim reset, pre-writing the
//   replacement's outbox row, keeping the claim PROCESSING, or ignoring
//   max_attempts.
//
// Covered:
//   T4  recovery through the scheduler's own steps, including the stale-claim
//       reset that runs before lease recovery,
//   H1  a live RUNNING execution keeps its claim across the stale reset,
//   H2  the replacement is claimed when due without an outbox unique violation,
//   H3  the replacement can actually run because recovery released the claim,
//   H4  recovery honours max_attempts and fails the job terminally.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { config } from '../src/config/env.config.js';
import { handlerRegistry } from '../src/handlers/handler.registry.js';
import * as IdempotencyRepository from '../src/modules/idempotency/idempotency.repository.js';
import * as LeaseRepository from '../src/modules/leases/leases.repository.js';
import {
  executeExistingExecution,
  recoverExpiredExecution,
} from '../src/modules/executions/execution.service.js';
import { executionDurationSeconds } from '../src/shared/metrics/execution.metrics.js';
import { jobsTotalFinalState } from '../src/shared/metrics/jobs.metrics.js';
import {
  closeTestPool,
  countExecutions,
  countOutboxForExecution,
  deleteJobCascade,
  getExecutions,
  getIdempotency,
  getJob,
  getLease,
  getOutboxForExecution,
} from './helpers/db.js';
import {
  createExecution,
  createIdempotency,
  createJob,
  createLease,
  makeRetryDue,
} from './helpers/fixtures.js';
import { counterValue, histogramCount } from './helpers/metrics.js';
import { claimDueExecutions, resetStaleIdempotency, runRecoveryPass } from './helpers/scheduler.js';

interface CrashedFixture {
  jobId: string;
  executionId: string;
  leaseId: string;
}

describe('Recovery and scheduler ordering', () => {
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

  const createCrashedExecution = async (options: {
    maxAttempts?: number;
    processingStartedAt?: Date;
    executionStartedAt?: Date;
    expiredLease?: boolean;
  } = {}): Promise<CrashedFixture> => {
    const job = await createJob({
      title: 'Recovery Fixture',
      status: 'RUNNING',
      maxAttempts: options.maxAttempts ?? 3,
    });
    createdJobIds.push(job.id);

    const execution = await createExecution(job.id, {
      status: 'RUNNING',
      attempt: 1,
      startedAt: options.executionStartedAt ?? new Date(Date.now() - 60_000),
    });

    await createIdempotency(job.id, {
      status: 'PROCESSING',
      processingStartedAt: options.processingStartedAt ?? new Date(),
    });

    const lease = await createLease(execution.id, {
      workerId: 'crashed-worker',
      expiresInMs: options.expiredLease === false ? 60_000 : -60_000,
    });

    return { jobId: job.id, executionId: execution.id, leaseId: lease.id };
  };

  it('marks the crashed attempt and schedules a replacement with no premature outbox row', async () => {
    const fixture = await createCrashedExecution();

    expect(await recoverExpiredExecution(fixture.executionId)).toBe(true);

    const executions = await getExecutions(fixture.jobId);
    expect(executions).toHaveLength(2);
    expect(executions[0]).toMatchObject({ attempt: 1, status: 'WORKER_CRASHED' });
    expect(executions[1]).toMatchObject({ attempt: 2, status: 'SCHEDULED' });

    // The job keeps running until the replacement attempt reaches a terminal
    // state, and the claim is free for the replacement.
    expect((await getJob(fixture.jobId)).status).toBe('RUNNING');
    expect((await getIdempotency(fixture.jobId)).status).toBe('PENDING');

    // A SCHEDULED execution must not be published; the due-execution claim
    // writes its outbox row later.
    expect(await getOutboxForExecution(executions[1]!.id)).toBeNull();
  });

  it('recovers a crashed attempt after the idempotency timeout without the stale reset interfering', async () => {
    const fixture = await createCrashedExecution({
      // Older than IDEMPOTENCY_PROCESSING_TIMEOUT_MS (30s) while the execution
      // is still below EXECUTION_TIMEOUT_MS (90s).
      processingStartedAt: new Date(Date.now() - 40_000),
      executionStartedAt: new Date(Date.now() - 40_000),
    });

    const result = await runRecoveryPass();

    expect(
      result.recoveryAttempts.some((attempt) => attempt.executionId === fixture.executionId),
    ).toBe(true);

    const executions = await getExecutions(fixture.jobId);
    expect(executions).toHaveLength(2);
    expect(executions[0]).toMatchObject({ attempt: 1, status: 'WORKER_CRASHED' });
    expect(executions[1]).toMatchObject({ attempt: 2, status: 'SCHEDULED' });
    expect((await getIdempotency(fixture.jobId)).status).toBe('PENDING');
  });

  it('keeps a live claim while its execution is still RUNNING', async () => {
    const fixture = await createCrashedExecution({
      processingStartedAt: new Date(Date.now() - 40_000),
      executionStartedAt: new Date(Date.now() - 40_000),
      // The worker is alive: its lease is still valid.
      expiredLease: false,
    });

    // The record is not even a stale candidate while its execution is RUNNING.
    const staleRecords = await IdempotencyRepository.getStaleProcessingRecords(
      config.idempotency.processingTimeout,
    );
    expect(staleRecords.some((record) => record.job_id === fixture.jobId)).toBe(false);

    await resetStaleIdempotency();

    // The claim belongs to the live worker and must survive the stale reset;
    // otherwise its success path cannot complete the idempotency record.
    expect((await getIdempotency(fixture.jobId)).status).toBe('PROCESSING');
    expect(await countExecutions(fixture.jobId)).toBe(1);
    expect((await getExecutions(fixture.jobId))[0]!.status).toBe('RUNNING');
  });

  it('claims the replacement execution when its retry is due, with a single outbox row', async () => {
    const fixture = await createCrashedExecution();

    expect(await recoverExpiredExecution(fixture.executionId)).toBe(true);

    const replacement = (await getExecutions(fixture.jobId)).find(
      (execution) => execution.attempt === 2,
    );

    await makeRetryDue(replacement!.id);

    const claimed = await claimDueExecutions(200);

    // The due-execution claim inserts the outbox row that recovery no longer
    // writes, so the unique outbox.execution_id constraint is satisfied.
    expect(claimed.map((execution) => execution.id)).toContain(replacement!.id);
    expect(await countOutboxForExecution(replacement!.id)).toBe(1);
    expect((await getOutboxForExecution(replacement!.id))?.status).toBe('PENDING');
    expect((await getExecutions(fixture.jobId)).find((row) => row.id === replacement!.id)!.status).toBe(
      'QUEUED',
    );
  });

  it('runs the replacement attempt to completion after recovery', async () => {
    const fixture = await createCrashedExecution({ maxAttempts: 3 });

    expect(await recoverExpiredExecution(fixture.executionId)).toBe(true);

    const replacement = (await getExecutions(fixture.jobId)).find(
      (execution) => execution.attempt === 2,
    );

    await makeRetryDue(replacement!.id);
    await claimDueExecutions(200);

    const handler = vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockResolvedValue(undefined);

    // The replacement is runnable because recovery released the claim.
    expect(await executeExistingExecution(replacement!.id, 'recovery-worker')).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    const executions = await getExecutions(fixture.jobId);
    expect(executions.find((row) => row.id === replacement!.id)!.status).toBe('COMPLETED');
    expect((await getJob(fixture.jobId)).status).toBe('COMPLETED');
    expect((await getIdempotency(fixture.jobId)).status).toBe('COMPLETED');
  });

  it('respects max_attempts: a crashed final attempt fails the job instead of adding an attempt', async () => {
    const fixture = await createCrashedExecution({ maxAttempts: 1 });

    const finalsBefore = await counterValue(jobsTotalFinalState, { status: 'FAILED' });
    const crashedDurationsBefore = await histogramCount(executionDurationSeconds, {
      status: 'WORKER_CRASHED',
    });

    expect(await recoverExpiredExecution(fixture.executionId)).toBe(true);

    const executions = await getExecutions(fixture.jobId);
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({ attempt: 1, status: 'WORKER_CRASHED' });
    expect((await getJob(fixture.jobId)).status).toBe('FAILED');

    // The crashed attempt ends at lease expiry (the last known-alive bound),
    // not at recovery time, so the duration does not measure detection delay.
    const lease = await getLease(fixture.executionId);
    const completedAt = new Date(executions[0]!.completed_at!).getTime();
    expect(Math.abs(completedAt - new Date(lease!.lease_expires_at).getTime())).toBeLessThan(1_000);
    expect(completedAt).toBeLessThan(Date.now() - 30_000);

    // One final-state transition and one terminal-attempt duration sample.
    expect(await counterValue(jobsTotalFinalState, { status: 'FAILED' })).toBe(finalsBefore + 1);
    expect(
      await histogramCount(executionDurationSeconds, { status: 'WORKER_CRASHED' }),
    ).toBe(crashedDurationsBefore + 1);
  });

  it('ignores the lease of an execution that already finished', async () => {
    const job = await createJob({ title: 'Terminal Lease Fixture', status: 'COMPLETED' });
    createdJobIds.push(job.id);

    const execution = await createExecution(job.id, {
      status: 'COMPLETED',
      attempt: 1,
      startedAt: new Date(Date.now() - 120_000),
      completedAt: new Date(Date.now() - 60_000),
    });

    await createLease(execution.id, { workerId: 'old-worker', expiresInMs: -60_000 });

    const expiredLeases = await LeaseRepository.findExpiredLeases();

    // A finished execution keeps its lease row as history, but it must not be
    // offered to recovery on every tick.
    expect(expiredLeases.some((lease) => lease.execution_id === execution.id)).toBe(false);
    expect(
      (await LeaseRepository.findLeaseByExecutionId(execution.id))?.worker_id,
    ).toBe('old-worker');
  });

  it('does not recover an execution whose lease is still valid', async () => {
    const fixture = await createCrashedExecution({ expiredLease: false });

    expect(await recoverExpiredExecution(fixture.executionId)).toBe(false);
    expect(await countExecutions(fixture.jobId)).toBe(1);
    expect((await getExecutions(fixture.jobId))[0]!.status).toBe('RUNNING');
  });
});
