import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { pool } from '../src/infrastructure/database/pool.js';
import { executeExistingExecution } from '../src/modules/executions/execution.service.js';
import { handlerRegistry } from '../src/handlers/handler.registry.js';

// Failure injection for the rollback tests. vi.mock factories are hoisted,
// so flags live on globalThis instead of test-scope closures.
declare global {
  // eslint-disable-next-line no-var
  var __failNewExecution: boolean;
  // eslint-disable-next-line no-var
  var __failSuccessJob: boolean;
  // eslint-disable-next-line no-var
  var __failFailedJob: boolean;
}

globalThis.__failNewExecution = false;
globalThis.__failSuccessJob = false;
globalThis.__failFailedJob = false;

// Keep the execution timeout short so timeout tests reject via the
// AbortSignal (~100ms) instead of sleeping through a real timeout.
vi.mock('../src/config/env.config.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/config/env.config.js')
  >();
  return {
    ...actual,
    config: { ...actual.config, execution: { timeout: 100 } },
  };
});

vi.mock('../src/modules/executions/execution.repository.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/modules/executions/execution.repository.js')
  >();
  return {
    ...actual,
    newExecution: async (...args: Parameters<typeof actual.newExecution>) => {
      if (globalThis.__failNewExecution) throw new Error('injected newExecution failure');
      return actual.newExecution(...args);
    },
  };
});

vi.mock('../src/modules/jobs/jobs.repository.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/modules/jobs/jobs.repository.js')
  >();
  return {
    ...actual,
    successJob: async (...args: Parameters<typeof actual.successJob>) => {
      if (globalThis.__failSuccessJob) throw new Error('injected successJob failure');
      return actual.successJob(...args);
    },
    failedJob: async (...args: Parameters<typeof actual.failedJob>) => {
      if (globalThis.__failFailedJob) throw new Error('injected failedJob failure');
      return actual.failedJob(...args);
    },
  };
});

interface Fixture {
  jobId: string;
  executionId: string;
  idempotencyKey: string;
}

describe('Execution lifecycle and retry', () => {
  const createdJobIds: string[] = [];

  const createFixture = async (maxAttempts = 3): Promise<Fixture> => {
    // QUEUED = the state the scheduler leaves the job in before the worker
    // picks it up (startJob claims QUEUED -> RUNNING).
    const jobResult = await pool.query(
      `
        INSERT INTO jobs (
          title, type, schedule_type, payload, run_at, max_attempts, status
        )
        VALUES ('Execution Test Job', 'SEND_EMAIL', 'ONCE', '{}', NOW(), $1, 'QUEUED')
        RETURNING id
      `,
      [maxAttempts],
    );
    const jobId: string = jobResult.rows[0].id;
    createdJobIds.push(jobId);

    const executionResult = await pool.query(
      `INSERT INTO executions (job_id, attempt, status)
       VALUES ($1, 1, 'QUEUED')
       RETURNING id`,
      [jobId],
    );

    // PENDING + NULL timestamp: executeExistingExecution atomically claims
    // PENDING -> PROCESSING, so any other fixture status would take an
    // early return and never reach the handler.
    const idempotencyResult = await pool.query(
      `INSERT INTO idempotency_records (job_id, idempotency_key, status, processing_started_at)
       VALUES ($1, $2, 'PENDING', NULL)
       RETURNING idempotency_key`,
      [jobId, crypto.randomUUID()],
    );

    return {
      jobId,
      executionId: executionResult.rows[0].id,
      idempotencyKey: idempotencyResult.rows[0].idempotency_key,
    };
  };

  const getExecution = async (id: string) => {
    const result = await pool.query(`SELECT * FROM executions WHERE id = $1`, [id]);
    return result.rows[0];
  };

  const getIdempotency = async (key: string) => {
    const result = await pool.query(
      `SELECT * FROM idempotency_records WHERE idempotency_key = $1`,
      [key],
    );
    return result.rows[0];
  };

  const getJob = async (id: string) => {
    const result = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
    return result.rows[0];
  };

  const countExecutions = async (jobId: string) => {
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM executions WHERE job_id = $1`, [
      jobId,
    ]);
    return result.rows[0].n as number;
  };

  afterEach(async () => {
    // executions.job_id has no ON DELETE CASCADE, so children go first.
    for (const jobId of createdJobIds.splice(0)) {
      await pool.query(`DELETE FROM executions WHERE job_id = $1`, [jobId]);
      await pool.query(`DELETE FROM idempotency_records WHERE job_id = $1`, [jobId]);
      await pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
    }

    globalThis.__failNewExecution = false;
    globalThis.__failSuccessJob = false;
    globalThis.__failFailedJob = false;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('successful execution completes execution, job, and idempotency', async () => {
    const { jobId, executionId, idempotencyKey } = await createFixture();
    vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockResolvedValue(undefined);

    const result = await executeExistingExecution(executionId);

    expect(result).toBe(true);
    expect((await getExecution(executionId)).status).toBe('COMPLETED');
    expect((await getJob(jobId)).status).toBe('COMPLETED');

    const idempotency = await getIdempotency(idempotencyKey);
    expect(idempotency.status).toBe('COMPLETED');
    expect(idempotency.processing_started_at).toBeNull();
  });

  it('handler failure with retry available fails execution 1 and schedules execution 2', async () => {
    const { executionId, idempotencyKey } = await createFixture();
    vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockRejectedValue(
      new Error('Test handler failure'),
    );

    const result = await executeExistingExecution(executionId);

    expect(result).toBe(false);

    const execution = await getExecution(executionId);
    expect(execution.status).toBe('FAILED');
    expect(execution.attempt).toBe(1);
    expect(execution.error).toContain('Test handler failure');

    const idempotency = await getIdempotency(idempotencyKey);
    expect(idempotency.status).toBe('PENDING');
    expect(idempotency.processing_started_at).toBeNull();

    const retries = await pool.query(
      `SELECT * FROM executions WHERE job_id = $1 ORDER BY attempt ASC`,
      [execution.job_id],
    );
    expect(retries.rows).toHaveLength(2);

    const retry = retries.rows[1];
    expect(retry.attempt).toBe(2);
    expect(retry.status).toBe('SCHEDULED');
    expect(retry.retry_at).not.toBeNull();
  });

  it('handler failure with no retries remaining fails the job and creates nothing', async () => {
    const { jobId, executionId, idempotencyKey } = await createFixture(1);
    vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockRejectedValue(
      new Error('Test handler failure'),
    );

    const result = await executeExistingExecution(executionId);

    expect(result).toBe(false);
    expect((await getExecution(executionId)).status).toBe('FAILED');
    expect((await getJob(jobId)).status).toBe('FAILED');
    expect(await countExecutions(jobId)).toBe(1);

    // Terminal failure keeps the claim; stale-timeout recovery owns it later.
    const idempotency = await getIdempotency(idempotencyKey);
    expect(idempotency.status).toBe('PROCESSING');
    expect(idempotency.processing_started_at).not.toBeNull();
  });

  it('success transaction rollback commits nothing on mid-transaction failure', async () => {
    const { jobId, executionId, idempotencyKey } = await createFixture();
    vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockResolvedValue(undefined);
    globalThis.__failSuccessJob = true;

    await expect(executeExistingExecution(executionId)).rejects.toThrow(
      'injected successJob failure',
    );

    // Started but nothing completed: all three writes were rolled back.
    expect((await getExecution(executionId)).status).toBe('RUNNING');
    expect((await getJob(jobId)).status).toBe('RUNNING');

    const idempotency = await getIdempotency(idempotencyKey);
    expect(idempotency.status).toBe('PROCESSING');
    expect(idempotency.processing_started_at).not.toBeNull();

    expect(await countExecutions(jobId)).toBe(1);
  });

  it('retry rollback leaves no orphan retry when retry creation fails', async () => {
    const { jobId, executionId, idempotencyKey } = await createFixture();
    vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockRejectedValue(
      new Error('Test handler failure'),
    );
    globalThis.__failNewExecution = true;

    // Single failure-with-retry transaction: ROLLBACK undoes the FAILED
    // mark and the PENDING reset together with the failed retry insert.
    await expect(executeExistingExecution(executionId)).rejects.toThrow(
      'injected newExecution failure',
    );

    expect((await getExecution(executionId)).status).toBe('RUNNING');
    expect((await getIdempotency(idempotencyKey)).status).toBe('PROCESSING');

    // ...and no orphan retry execution was created.
    expect(await countExecutions(jobId)).toBe(1);
  });

  // Handler that only rejects when the service aborts it on timeout.
  // Resolves never on its own, so the AbortSignal (~100ms, mocked
  // EXECUTION_TIMEOUT_MS) is what ends the handler and sets
  // timeoutTriggered = true in the service.
  const mockTimeoutHandler = () =>
    vi.spyOn(handlerRegistry, 'SEND_EMAIL').mockImplementation(
      (_payload: unknown, signal?: AbortSignal) =>
        new Promise<undefined>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );

  it('timeout with retry available marks TIMED_OUT and schedules execution 2', async () => {
    const { jobId, executionId, idempotencyKey } = await createFixture(2);
    mockTimeoutHandler();

    const result = await executeExistingExecution(executionId);

    expect(result).toBe(false);

    const execution = await getExecution(executionId);
    expect(execution.status).toBe('TIMED_OUT');
    expect(execution.attempt).toBe(1);

    const retries = await pool.query(
      `SELECT * FROM executions WHERE job_id = $1 ORDER BY attempt ASC`,
      [jobId],
    );
    expect(retries.rows).toHaveLength(2);

    const retry = retries.rows[1];
    expect(retry.attempt).toBe(2);
    expect(retry.status).toBe('SCHEDULED');
    expect(retry.retry_at).not.toBeNull();

    const idempotency = await getIdempotency(idempotencyKey);
    expect(idempotency.status).toBe('PENDING');
    expect(idempotency.processing_started_at).toBeNull();

    expect((await getJob(jobId)).status).toBe('RUNNING');
  });

  it('timeout on final attempt marks TIMED_OUT and fails the job', async () => {
    const { jobId, executionId } = await createFixture(1);
    mockTimeoutHandler();

    const result = await executeExistingExecution(executionId);

    expect(result).toBe(false);
    expect((await getExecution(executionId)).status).toBe('TIMED_OUT');
    expect((await getJob(jobId)).status).toBe('FAILED');
    expect(await countExecutions(jobId)).toBe(1);
  });

  it('timeout retry transaction rolls back when retry creation fails', async () => {
    const { jobId, executionId, idempotencyKey } = await createFixture(2);
    mockTimeoutHandler();
    globalThis.__failNewExecution = true;

    await expect(executeExistingExecution(executionId)).rejects.toThrow(
      'injected newExecution failure',
    );

    // Nothing from the transaction persists: execution was RUNNING
    // before BEGIN, no retry was created, claim was not reset.
    expect((await getExecution(executionId)).status).toBe('RUNNING');
    expect(await countExecutions(jobId)).toBe(1);

    const idempotency = await getIdempotency(idempotencyKey);
    expect(idempotency.status).toBe('PROCESSING');
    expect(idempotency.processing_started_at).not.toBeNull();
  });

  it('final timeout transaction rolls back when job failure fails', async () => {
    const { jobId, executionId } = await createFixture(1);
    mockTimeoutHandler();
    globalThis.__failFailedJob = true;

    await expect(executeExistingExecution(executionId)).rejects.toThrow(
      'injected failedJob failure',
    );

    expect((await getExecution(executionId)).status).toBe('RUNNING');
    expect((await getJob(jobId)).status).toBe('RUNNING');
  });
});
