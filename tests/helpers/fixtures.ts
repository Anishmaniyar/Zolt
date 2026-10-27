// Fixture builders for the job/execution/idempotency/outbox/lease tables.
//
// The helpers insert raw rows so a test can start from any valid state
// (QUEUED, RUNNING, expired lease, stale claim, etc.) without calling the
// scheduler or worker first. Every helper returns the inserted row and the
// caller is responsible for adding the job id to its cleanup list.

import crypto from 'node:crypto';

import { pool } from '../../src/infrastructure/database/pool.js';
import type { ExecutionRow, IdempotencyRow, JobRow, LeaseRow, OutboxRow } from './db.js';

interface CreateJobOptions {
  title?: string;
  type?: string;
  scheduleType?: 'IMMEDIATE' | 'ONCE';
  status?: string;
  maxAttempts?: number;
  runAt?: Date;
  payload?: Record<string, unknown> | null;
}

export async function createJob(options: CreateJobOptions = {}): Promise<JobRow> {
  const result = await pool.query<JobRow>(
    `
      INSERT INTO jobs (
        title, type, schedule_type, payload, run_at, max_attempts, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      options.title ?? `Fixture Job ${crypto.randomUUID()}`,
      options.type ?? 'SEND_EMAIL',
      options.scheduleType ?? 'ONCE',
      options.payload ?? {},
      options.runAt ?? new Date(),
      options.maxAttempts ?? 3,
      options.status ?? 'SCHEDULED',
    ],
  );

  return result.rows[0]!;
}

interface CreateExecutionOptions {
  attempt?: number;
  status?: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  retryAt?: Date | null;
  error?: string | null;
}

export async function createExecution(
  jobId: string,
  options: CreateExecutionOptions = {},
): Promise<ExecutionRow> {
  const result = await pool.query<ExecutionRow>(
    `
      INSERT INTO executions (
        job_id, attempt, status, started_at, completed_at, retry_at, error
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      jobId,
      options.attempt ?? 1,
      options.status ?? 'QUEUED',
      options.startedAt ?? null,
      options.completedAt ?? null,
      options.retryAt ?? null,
      options.error ?? null,
    ],
  );

  return result.rows[0]!;
}

interface CreateIdempotencyOptions {
  status?: 'PENDING' | 'PROCESSING' | 'COMPLETED';
  processingStartedAt?: Date | null;
  key?: string;
}

export async function createIdempotency(
  jobId: string,
  options: CreateIdempotencyOptions = {},
): Promise<IdempotencyRow> {
  const status = options.status ?? 'PENDING';

  const result = await pool.query<IdempotencyRow>(
    `
      INSERT INTO idempotency_records (
        job_id, idempotency_key, status, processing_started_at
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [
      jobId,
      options.key ?? crypto.randomUUID(),
      status,
      options.processingStartedAt ?? (status === 'PROCESSING' ? new Date() : null),
    ],
  );

  return result.rows[0]!;
}

interface CreateLeaseOptions {
  workerId?: string;
  // Positive values expire in the future; negative values are already expired.
  expiresInMs?: number;
}

export async function createLease(
  executionId: string,
  options: CreateLeaseOptions = {},
): Promise<LeaseRow> {
  const result = await pool.query<LeaseRow>(
    `
      INSERT INTO leases (execution_id, worker_id, lease_expires_at)
      VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'))
      RETURNING *
    `,
    [executionId, options.workerId ?? 'worker-a', options.expiresInMs ?? 60_000],
  );

  return result.rows[0]!;
}

export async function createJobOutbox(
  jobId: string,
  status: 'PENDING' | 'PUBLISHED' = 'PENDING',
): Promise<OutboxRow> {
  const result = await pool.query<OutboxRow>(
    `
      INSERT INTO outbox (job_id, status, published_at)
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [jobId, status, status === 'PUBLISHED' ? new Date() : null],
  );

  return result.rows[0]!;
}

export async function createExecutionOutbox(
  executionId: string,
  status: 'PENDING' | 'PUBLISHED' = 'PENDING',
): Promise<OutboxRow> {
  const result = await pool.query<OutboxRow>(
    `
      INSERT INTO outbox (execution_id, status, published_at)
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [executionId, status, status === 'PUBLISHED' ? new Date() : null],
  );

  return result.rows[0]!;
}

export interface ExecutableFixture {
  job: JobRow;
  execution: ExecutionRow;
  idempotency: IdempotencyRow;
}

// Creates the exact state a worker sees when it starts a first attempt.
export async function createExecutableJob(
  jobOptions: CreateJobOptions = {},
  executionOptions: CreateExecutionOptions = {},
): Promise<ExecutableFixture> {
  const job = await createJob({
    status: 'QUEUED',
    maxAttempts: 3,
    ...jobOptions,
  });

  const execution = await createExecution(job.id, {
    status: 'QUEUED',
    attempt: 1,
    ...executionOptions,
  });

  const idempotency = await createIdempotency(job.id, { status: 'PENDING' });

  return { job, execution, idempotency };
}

// Makes a SCHEDULED retry due for the scheduler's due-execution query.
export async function makeRetryDue(executionId: string): Promise<void> {
  await pool.query(`UPDATE executions SET retry_at = NOW() WHERE id = $1`, [executionId]);
}

// Makes a QUEUED job/execution old enough for queue reconciliation.
export async function makeOlderThan(executionId: string, ms: number): Promise<void> {
  await pool.query(
    `UPDATE executions SET updated_at = NOW() - ($2 * INTERVAL '1 millisecond') WHERE id = $1`,
    [executionId, ms],
  );
}

export async function makeJobOlderThan(jobId: string, ms: number): Promise<void> {
  await pool.query(
    `UPDATE jobs SET updated_at = NOW() - ($2 * INTERVAL '1 millisecond') WHERE id = $1`,
    [jobId, ms],
  );
}

export async function expireLease(executionId: string): Promise<void> {
  await pool.query(
    `UPDATE leases
     SET lease_expires_at = NOW() - INTERVAL '1 minute', updated_at = NOW()
     WHERE execution_id = $1`,
    [executionId],
  );
}

export async function setProcessingStartedAt(jobId: string, at: Date): Promise<void> {
  await pool.query(
    `UPDATE idempotency_records
     SET processing_started_at = $2, status = 'PROCESSING', updated_at = NOW()
     WHERE job_id = $1`,
    [jobId, at],
  );
}
