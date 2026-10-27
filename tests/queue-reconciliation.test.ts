// Queue reconciliation tests (T9) and the retained-entry repair (M5).
//
// How it works:
//   The first describe block mocks the queue module so a test can decide, per
//   fixture, whether its deterministic BullMQ entry is missing, runnable, or
//   retained in a terminal state. `processQueueReconciliation` is then called
//   directly, with no scheduler process and no reachable Redis.
//
//   The second describe block uses a private BullMQ queue name and a real
//   Worker to pin the library behaviour the repair depends on: a retained
//   failed entry absorbs the same deterministic id, and removing that entry
//   makes the id addable again.
//
// Covered:
//   T9  missing entries are re-enqueued, runnable entries are left alone, and
//       rows younger than the minimum age are ignored,
//   M5  a retained terminal entry is removed before the re-enqueue, so the DB
//       row becomes runnable instead of staying QUEUED forever.

import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import crypto from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queueState = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  removedEntries: [] as string[],
  enqueuedJobs: [] as Array<Array<{ id: string }>>,
  enqueuedExecutions: [] as Array<Array<{ id: string }>>,
}));

vi.mock('../src/infrastructure/queue/queue.js', () => ({
  getJobQueueId: (jobId: string) => `job-${jobId}`,
  getExecutionQueueId: (executionId: string) => `exec-${executionId}`,
  getQueueJob: async (jobId: string) => {
    const key = `job-${jobId}`;
    const state = queueState.entries.get(key);
    return state ? { id: key, key, state } : null;
  },
  getQueueExecution: async (executionId: string) => {
    const key = `exec-${executionId}`;
    const state = queueState.entries.get(key);
    return state ? { id: key, key, state } : null;
  },
  removeTerminalQueueEntry: async (entry: { key?: string; state?: string } | null) => {
    if (!entry?.key) return false;
    if (entry.state !== 'failed' && entry.state !== 'completed') return false;

    queueState.removedEntries.push(entry.key);
    queueState.entries.delete(entry.key);

    return true;
  },
  isQueueEntryRunnable: async (entry: { state?: string } | null) =>
    Boolean(
      entry &&
        ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'].includes(
          entry.state ?? '',
        ),
    ),
  enqueueJobs: async (jobs: Array<{ id: string }>) => {
    queueState.enqueuedJobs.push(jobs);

    for (const job of jobs) {
      const key = `job-${job.id}`;
      // Mirrors BullMQ: an id still occupied by a retained entry absorbs the
      // add instead of producing new runnable work.
      if (!queueState.entries.has(key)) queueState.entries.set(key, 'waiting');
    }

    return jobs.map((job) => ({
      id: `job-${job.id}`,
      state: queueState.entries.get(`job-${job.id}`) ?? 'waiting',
    }));
  },
  enqueueExecutions: async (executions: Array<{ id: string }>) => {
    queueState.enqueuedExecutions.push(executions);

    for (const execution of executions) {
      const key = `exec-${execution.id}`;
      if (!queueState.entries.has(key)) queueState.entries.set(key, 'waiting');
    }

    return executions.map((execution) => ({
      id: `exec-${execution.id}`,
      state: queueState.entries.get(`exec-${execution.id}`) ?? 'waiting',
    }));
  },
}));

import { config } from '../src/config/env.config.js';
import { processQueueReconciliation } from '../src/modules/queue-reconciliation/queue-reconciliation.service.js';
import { closeTestPool, deleteJobCascade, getJob } from './helpers/db.js';
import {
  createExecution,
  createIdempotency,
  createJob,
  makeJobOlderThan,
  makeOlderThan,
} from './helpers/fixtures.js';

const olderThanMinAge = config.queueReconciliation.minAge + 60_000;

const wasJobEnqueued = (jobId: string) =>
  queueState.enqueuedJobs.some((batch) => batch.some((item) => item.id === jobId));

const wasExecutionEnqueued = (executionId: string) =>
  queueState.enqueuedExecutions.some((batch) => batch.some((item) => item.id === executionId));

describe('Queue reconciliation', () => {
  const createdJobIds: string[] = [];

  beforeEach(() => {
    queueState.entries.clear();
    queueState.removedEntries.length = 0;
    queueState.enqueuedJobs.length = 0;
    queueState.enqueuedExecutions.length = 0;
  });

  afterEach(async () => {
    for (const jobId of createdJobIds.splice(0)) {
      await deleteJobCascade(jobId);
    }
  });

  afterAll(async () => {
    await closeTestPool();
  });

  const createQueuedJob = async (title: string) => {
    const job = await createJob({ title: `${title} ${crypto.randomUUID()}`, status: 'QUEUED' });
    createdJobIds.push(job.id);
    await createIdempotency(job.id);
    await makeJobOlderThan(job.id, olderThanMinAge);

    return job;
  };

  it('re-enqueues a QUEUED job whose deterministic queue entry is missing', async () => {
    const job = await createQueuedJob('Reconciliation Missing');

    const reenqueued = await processQueueReconciliation();

    expect(reenqueued).toBeGreaterThanOrEqual(1);
    expect(wasJobEnqueued(job.id)).toBe(true);
    expect((await getJob(job.id)).status).toBe('QUEUED');
    expect(queueState.entries.get(`job-${job.id}`)).toBe('waiting');

    await processQueueReconciliation();

    // Once the entry is runnable the row is left alone.
    expect(queueState.enqueuedJobs.flat().filter((item) => item.id === job.id)).toHaveLength(1);
  });

  it('leaves a QUEUED execution alone while its entry is runnable', async () => {
    const job = await createQueuedJob('Reconciliation Runnable');
    const execution = await createExecution(job.id, { status: 'QUEUED', attempt: 1 });
    await makeOlderThan(execution.id, olderThanMinAge);

    queueState.entries.set(`exec-${execution.id}`, 'active');

    await processQueueReconciliation();

    expect(wasExecutionEnqueued(execution.id)).toBe(false);
  });

  it('ignores QUEUED rows younger than the minimum reconciliation age', async () => {
    const job = await createJob({
      title: `Reconciliation Fresh ${crypto.randomUUID()}`,
      status: 'QUEUED',
    });
    createdJobIds.push(job.id);
    await createIdempotency(job.id);

    await processQueueReconciliation();

    expect(wasJobEnqueued(job.id)).toBe(false);
  });

  it('recovers a QUEUED job whose entry is retained in the failed set', async () => {
    const job = await createQueuedJob('Reconciliation Retained');

    queueState.entries.set(`job-${job.id}`, 'failed');

    const firstPass = await processQueueReconciliation();

    expect(firstPass).toBeGreaterThanOrEqual(1);

    // The retained entry is removed first, so the re-enqueue actually creates
    // runnable work instead of being absorbed by the old failed entry.
    expect(queueState.removedEntries).toContain(`job-${job.id}`);
    expect(wasJobEnqueued(job.id)).toBe(true);
    expect(queueState.entries.get(`job-${job.id}`)).toBe('waiting');

    const secondPass = await processQueueReconciliation();

    expect(secondPass).toBeGreaterThanOrEqual(0);

    // The row is runnable now: no second removal and no second enqueue.
    expect(queueState.enqueuedJobs.flat().filter((item) => item.id === job.id)).toHaveLength(1);
    expect((await getJob(job.id)).status).toBe('QUEUED');
  });
});

describe('BullMQ retained terminal entries (real queue behaviour behind M5)', () => {
  const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
  const queueName = `jobs-reconciliation-probe-${crypto.randomUUID().slice(0, 8)}`;
  const queue = new Queue(queueName, {
    connection,
    defaultJobOptions: { attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 },
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await connection.quit();
  });

  it('adding over a retained failed entry is a no-op until the entry is removed', async () => {
    const executionId = crypto.randomUUID();
    const queueJobId = `exec-${executionId}`;

    await queue.add('execute-execution', { executionId }, { jobId: queueJobId });

    expect(await (await queue.getJob(queueJobId))!.getState()).toBe('waiting');

    let workerClosed = false;

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('forced terminal failure');
      },
      { connection: connection.duplicate({ maxRetriesPerRequest: null }) },
    );

    try {
      await new Promise<void>((resolve) => worker.once('failed', () => resolve()));

      expect(await (await queue.getJob(queueJobId))!.getState()).toBe('failed');

      const absorbed = await queue.addBulk([
        { name: 'execute-execution', data: { executionId }, opts: { jobId: queueJobId } },
      ]);

      // Without the removal, the retained entry absorbs the re-add.
      expect(absorbed).toHaveLength(1);
      expect(await absorbed[0]!.getState()).toBe('failed');
      expect((await queue.getJobCounts('waiting')).waiting).toBe(0);

      // Stop consuming before proving the id is runnable again, otherwise the
      // worker would move the re-added entry straight to active.
      await worker.close();
      workerClosed = true;

      // Removing the terminal entry frees the deterministic id again, which is
      // exactly what reconciliation now does before re-enqueueing.
      await (await queue.getJob(queueJobId))!.remove();

      const readded = await queue.addBulk([
        { name: 'execute-execution', data: { executionId }, opts: { jobId: queueJobId } },
      ]);

      expect(await readded[0]!.getState()).toBe('waiting');
      expect((await queue.getJobCounts('waiting')).waiting).toBe(1);
    } finally {
      if (!workerClosed) await worker.close();
    }

    await queue.getJob(queueJobId).then((job) => job?.remove());
  });
});
