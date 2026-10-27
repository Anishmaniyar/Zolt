import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queueMocks = vi.hoisted(() => ({
  enqueueJobs: vi.fn(),
  enqueueExecutions: vi.fn(),
  getQueueJob: vi.fn(),
  getQueueExecution: vi.fn(),
  isQueueEntryRunnable: vi.fn(),
  getQueueJobCounts: vi.fn(),
}));

vi.mock('../src/infrastructure/queue/queue.js', () => queueMocks);

import { config } from '../src/config/env.config.js';
import { pool } from '../src/infrastructure/database/pool.js';
import { processPendingOutbox } from '../src/modules/scheduler/scheduler.service.js';
import {
  outboxPending,
  outboxOldestPendingAgeSeconds,
} from '../src/shared/metrics/outbox.metrics.js';

describe('Outbox publish failure recovery', () => {
  const createdJobIds: string[] = [];

  const createJob = async () => {
    const result = await pool.query(
      `
        INSERT INTO jobs (title, type, schedule_type, payload, run_at, max_attempts, status)
        VALUES ('Outbox Test Job', 'SEND_EMAIL', 'ONCE', '{}', NOW(), 1, 'QUEUED')
        RETURNING id
      `,
    );

    const jobId: string = result.rows[0].id;
    createdJobIds.push(jobId);

    return jobId;
  };

  const createJobOutbox = async (jobId: string) => {
    const result = await pool.query(
      `INSERT INTO outbox (job_id, status) VALUES ($1, 'PENDING') RETURNING id`,
      [jobId],
    );

    return result.rows[0].id as string;
  };

  const createExecutionOutbox = async (jobId: string) => {
    const execution = await pool.query(
      `INSERT INTO executions (job_id, attempt, status) VALUES ($1, 1, 'QUEUED') RETURNING id`,
      [jobId],
    );

    const executionId: string = execution.rows[0].id;

    const result = await pool.query(
      `INSERT INTO outbox (execution_id, status) VALUES ($1, 'PENDING') RETURNING id`,
      [executionId],
    );

    return result.rows[0].id as string;
  };

  const getOutbox = async (id: string) => {
    const result = await pool.query(`SELECT * FROM outbox WHERE id = $1`, [id]);
    return result.rows[0];
  };

  const getOutboxPending = async () => (await outboxPending.get()).values[0]?.value ?? 0;

  const getOutboxOldestAge = async () =>
    (await outboxOldestPendingAgeSeconds.get()).values[0]?.value ?? 0;

  beforeEach(() => {
    queueMocks.enqueueJobs.mockReset();
    queueMocks.enqueueExecutions.mockReset();
  });

  afterEach(async () => {
    for (const jobId of createdJobIds.splice(0)) {
      await pool.query(
        `DELETE FROM outbox WHERE execution_id IN (SELECT id FROM executions WHERE job_id = $1)`,
        [jobId],
      );
      await pool.query(`DELETE FROM outbox WHERE job_id = $1`, [jobId]);
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

  it('job outbox stays PENDING when the BullMQ publish fails', async () => {
    const jobId = await createJob();
    const outboxId = await createJobOutbox(jobId);

    queueMocks.enqueueJobs.mockRejectedValueOnce(new Error('Redis down'));

    const processed = await processPendingOutbox();

    expect(processed).toBe(0);

    const outbox = await getOutbox(outboxId);
    expect(outbox.status).toBe('PENDING');
    expect(outbox.published_at).toBeNull();
  });

  it('outbox gauges reflect the pending backlog', async () => {
    const jobId = await createJob();
    await createJobOutbox(jobId);

    queueMocks.enqueueJobs.mockRejectedValueOnce(new Error('Redis down'));

    await processPendingOutbox();

    expect(await getOutboxPending()).toBeGreaterThanOrEqual(1);
    expect(await getOutboxOldestAge()).toBeGreaterThanOrEqual(0);
  });

  it('execution outbox stays PENDING when the BullMQ publish fails', async () => {
    const jobId = await createJob();
    const outboxId = await createExecutionOutbox(jobId);

    queueMocks.enqueueExecutions.mockRejectedValueOnce(new Error('Redis down'));

    const processed = await processPendingOutbox();

    expect(processed).toBe(0);

    const outbox = await getOutbox(outboxId);
    expect(outbox.status).toBe('PENDING');
    expect(outbox.published_at).toBeNull();
  });

  it('execution outbox is not stranded when the job publish in the same batch fails', async () => {
    const jobId = await createJob();
    const jobOutboxId = await createJobOutbox(jobId);
    const executionOutboxId = await createExecutionOutbox(jobId);

    queueMocks.enqueueJobs.mockRejectedValueOnce(new Error('Redis down'));

    const processed = await processPendingOutbox();

    expect(processed).toBe(0);
    expect(queueMocks.enqueueExecutions).not.toHaveBeenCalled();

    expect((await getOutbox(jobOutboxId)).status).toBe('PENDING');
    expect((await getOutbox(executionOutboxId)).status).toBe('PENDING');
    expect((await getOutbox(executionOutboxId)).published_at).toBeNull();
  });

  it('prunes PUBLISHED rows past the retention window and keeps recent ones', async () => {
    const staleJobId = await createJob();
    const staleOutboxId = await createJobOutbox(staleJobId);
    const recentJobId = await createJob();
    const recentOutboxId = await createJobOutbox(recentJobId);

    await pool.query(
      `UPDATE outbox
       SET status = 'PUBLISHED', published_at = NOW() - ($2 * INTERVAL '1 millisecond'), updated_at = NOW()
       WHERE id = $1`,
      [staleOutboxId, config.outbox.retention + 60_000],
    );

    await pool.query(
      `UPDATE outbox
       SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [recentOutboxId],
    );

    await processPendingOutbox();

    // History past the retention window is dropped; recent history is kept.
    expect(await getOutbox(staleOutboxId)).toBeUndefined();
    expect((await getOutbox(recentOutboxId)).status).toBe('PUBLISHED');
  });

  it('outbox becomes PUBLISHED once Redis recovers', async () => {
    const jobId = await createJob();
    const outboxId = await createJobOutbox(jobId);

    queueMocks.enqueueJobs.mockRejectedValueOnce(new Error('Redis down'));
    await processPendingOutbox();

    expect((await getOutbox(outboxId)).status).toBe('PENDING');

    queueMocks.enqueueJobs.mockResolvedValueOnce([]);

    const processed = await processPendingOutbox();

    expect(processed).toBe(1);
    expect(queueMocks.enqueueJobs).toHaveBeenCalledWith([{ id: jobId }]);

    const outbox = await getOutbox(outboxId);
    expect(outbox.status).toBe('PUBLISHED');
    expect(outbox.published_at).not.toBeNull();
  });
});
