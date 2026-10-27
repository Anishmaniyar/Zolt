// Scheduler claim concurrency tests (T5) and the cancel/claim race (T7).
//
// How it works:
//   Each test creates a small set of due fixtures, then starts two claim
//   transactions at the same time. Postgres row locks (`FOR UPDATE SKIP
//   LOCKED`) must hand every row to exactly one claimer, and the outbox
//   insert inside the same transaction must produce exactly one row per claim.
//   The tests assert on the fixtures they created, never on global counts.
//
// Why the guard:
//   A development scheduler ticks every 15 seconds against the same database
//   and would claim these fixtures first. The whole file is skipped while a
//   development process is detected (see helpers/runtime.ts).
//
// Covered:
//   T5  two schedulers claiming due jobs, due executions, and pending outbox,
//   T7  cancel racing a due-job claim: exactly one of QUEUED/CANCELLED wins
//       with a single final-state metric increment.

import crypto from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { cancelJobService } from '../src/modules/jobs/jobs.service.js';
import { jobsTotalFinalState } from '../src/shared/metrics/jobs.metrics.js';
import {
  closeTestPool,
  countOutboxForExecution,
  countOutboxForJob,
  deleteJobCascade,
  getJob,
  getOutboxForJob,
} from './helpers/db.js';
import { createExecution, createIdempotency, createJob, createJobOutbox } from './helpers/fixtures.js';
import { counterValue } from './helpers/metrics.js';
import { exclusiveRuntime, LIVE_RUNTIME_SKIP_REASON } from './helpers/runtime.js';
import { claimDueExecutions, claimDueJobs, publishPendingOutbox } from './helpers/scheduler.js';

const dueMs = 1_000;

describe.skipIf(!exclusiveRuntime)('Scheduler claim concurrency', () => {
  const createdJobIds: string[] = [];

  afterEach(async () => {
    for (const jobId of createdJobIds.splice(0)) {
      await deleteJobCascade(jobId);
    }
  });

  afterAll(async () => {
    await closeTestPool();
  });

  if (!exclusiveRuntime) {
    // Visible in the report so a skipped file is never mistaken for a pass.
    it.skip(`skipped: ${LIVE_RUNTIME_SKIP_REASON}`, () => undefined);
  }

  const createDueJob = async (title: string) => {
    const job = await createJob({
      title: `${title} ${crypto.randomUUID()}`,
      status: 'SCHEDULED',
      scheduleType: 'IMMEDIATE',
      runAt: new Date(Date.now() - dueMs),
      maxAttempts: 1,
    });

    createdJobIds.push(job.id);

    await createIdempotency(job.id);

    return job;
  };

  it('hands every due job to exactly one of two concurrent schedulers', async () => {
    const jobs = await Promise.all(
      Array.from({ length: 6 }, (_, index) => createDueJob(`Concurrent Claim ${index}`)),
    );

    const [claimA, claimB] = await Promise.all([claimDueJobs(200), claimDueJobs(200)]);

    const claimedIds = [...claimA, ...claimB].map((job) => job.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);

    for (const job of jobs) {
      expect(claimedIds.filter((id) => id === job.id)).toHaveLength(1);
      expect((await getJob(job.id)).status).toBe('QUEUED');
      expect((await getOutboxForJob(job.id))?.status).toBe('PENDING');
      expect(await countOutboxForJob(job.id)).toBe(1);
    }
  });

  it('hands every due execution to exactly one of two concurrent schedulers', async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const job = await createJob({
          title: `Concurrent Execution Claim ${index} ${crypto.randomUUID()}`,
          status: 'RUNNING',
          maxAttempts: 3,
        });

        createdJobIds.push(job.id);
        await createIdempotency(job.id, { status: 'PENDING' });

        const execution = await createExecution(job.id, {
          status: 'SCHEDULED',
          attempt: 2,
          retryAt: new Date(Date.now() - dueMs),
        });

        return { job, execution };
      }),
    );

    const [first, second] = await Promise.all([claimDueExecutions(200), claimDueExecutions(200)]);

    const claimedIds = [...first, ...second].map((execution) => execution.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);

    for (const { execution } of fixtures) {
      expect(claimedIds.filter((id) => id === execution.id)).toHaveLength(1);
      expect(await countOutboxForExecution(execution.id)).toBe(1);
    }
  });

  it('publishes every pending outbox row exactly once across two concurrent schedulers', async () => {
    const jobs = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const job = await createJob({
          title: `Concurrent Outbox Claim ${index} ${crypto.randomUUID()}`,
          status: 'QUEUED',
          maxAttempts: 1,
        });

        createdJobIds.push(job.id);
        await createIdempotency(job.id);

        const outbox = await createJobOutbox(job.id);

        return { job, outbox };
      }),
    );

    const [first, second] = await Promise.all([publishPendingOutbox(200), publishPendingOutbox(200)]);

    const claimedIds = [...first, ...second].map((outbox) => outbox.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);

    for (const { outbox } of jobs) {
      expect(claimedIds.filter((id) => id === outbox.id)).toHaveLength(1);
    }

    expect((await getOutboxForJob(jobs[0]!.job.id))?.status).toBe('PUBLISHED');
  });

  it('leaves exactly one terminal outcome when a cancel races a scheduler claim', async () => {
    const job = await createDueJob('Cancel Race');

    const before = await counterValue(jobsTotalFinalState, { status: 'CANCELLED' });

    const [claimResult, cancelResult] = await Promise.allSettled([
      claimDueJobs(200),
      cancelJobService({ id: job.id }),
    ]);

    expect(claimResult.status).toBe('fulfilled');

    const claimedByScheduler = (claimResult.value as Array<{ id: string }>).some(
      (claimed) => claimed.id === job.id,
    );
    const cancelledByApi = cancelResult.status === 'fulfilled';

    // Exactly one of the two operations owns the transition.
    expect(Number(claimedByScheduler) + Number(cancelledByApi)).toBe(1);

    const finalStatus = (await getJob(job.id)).status;

    if (cancelledByApi) {
      expect(finalStatus).toBe('CANCELLED');
      expect(await countOutboxForJob(job.id)).toBe(0);
      expect(await counterValue(jobsTotalFinalState, { status: 'CANCELLED' })).toBe(before + 1);
    } else {
      // The service refuses to cancel a QUEUED job with a 409.
      expect(cancelResult.status).toBe('rejected');
      expect((cancelResult as PromiseRejectedResult).reason.statusCode).toBe(409);
      expect(finalStatus).toBe('QUEUED');
      expect(await countOutboxForJob(job.id)).toBe(1);
      expect(await counterValue(jobsTotalFinalState, { status: 'CANCELLED' })).toBe(before);
    }
  });
});
