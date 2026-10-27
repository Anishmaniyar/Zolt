// Shared database helpers for integration tests.
//
// Every test file owns the rows it creates and removes them in afterEach /
// afterAll through `deleteJobCascade`. Deletion order matters because the
// schema has these foreign keys:
//   outbox -> jobs/executions, leases -> executions,
//   executions -> jobs, idempotency_records -> jobs (cascade).
// Tests are designed to run against a dedicated test database. They use the
// same DATABASE_URL as the app because the project does not have a separate
// test configuration; set DATABASE_URL to a disposable database before running.

import { pool } from '../../src/infrastructure/database/pool.js';

export interface JobRow {
  id: string;
  type: string;
  schedule_type: 'IMMEDIATE' | 'ONCE';
  status: string;
  max_attempts: number;
  run_at: Date;
  title: string;
}

export interface ExecutionRow {
  id: string;
  job_id: string;
  attempt: number;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  retry_at: Date | null;
  error: string | null;
}

export interface IdempotencyRow {
  id: string;
  job_id: string;
  idempotency_key: string;
  status: string;
  processing_started_at: Date | null;
}

export interface OutboxRow {
  id: string;
  job_id: string | null;
  execution_id: string | null;
  status: string;
  published_at: Date | null;
}

export interface LeaseRow {
  id: string;
  execution_id: string;
  worker_id: string;
  lease_expires_at: Date;
}

// Removes all rows owned by a job in dependency order.
export async function deleteJobCascade(jobId: string): Promise<void> {
  await pool.query(
    `DELETE FROM outbox
     WHERE job_id = $1
        OR execution_id IN (SELECT id FROM executions WHERE job_id = $1)`,
    [jobId],
  );

  await pool.query(
    `DELETE FROM leases
     WHERE execution_id IN (SELECT id FROM executions WHERE job_id = $1)`,
    [jobId],
  );

  await pool.query(`DELETE FROM executions WHERE job_id = $1`, [jobId]);
  await pool.query(`DELETE FROM idempotency_records WHERE job_id = $1`, [jobId]);
  await pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
}

export async function deleteJobsCascade(jobIds: string[]): Promise<void> {
  for (const jobId of jobIds) {
    await deleteJobCascade(jobId);
  }
}

export async function getJob(jobId: string): Promise<JobRow> {
  const result = await pool.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [jobId]);

  return result.rows[0]!;
}

export async function getExecution(executionId: string): Promise<ExecutionRow> {
  const result = await pool.query<ExecutionRow>(`SELECT * FROM executions WHERE id = $1`, [
    executionId,
  ]);

  return result.rows[0]!;
}

export async function getExecutions(jobId: string): Promise<ExecutionRow[]> {
  const result = await pool.query<ExecutionRow>(
    `SELECT * FROM executions WHERE job_id = $1 ORDER BY attempt ASC, created_at ASC`,
    [jobId],
  );

  return result.rows;
}

export async function countExecutions(jobId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM executions WHERE job_id = $1`,
    [jobId],
  );

  return result.rows[0]!.n;
}

export async function getIdempotency(jobId: string): Promise<IdempotencyRow> {
  const result = await pool.query<IdempotencyRow>(
    `SELECT * FROM idempotency_records WHERE job_id = $1`,
    [jobId],
  );

  return result.rows[0]!;
}

export async function getOutboxForJob(jobId: string): Promise<OutboxRow | null> {
  const result = await pool.query<OutboxRow>(`SELECT * FROM outbox WHERE job_id = $1`, [jobId]);

  return result.rows[0] ?? null;
}

export async function getOutboxForExecution(executionId: string): Promise<OutboxRow | null> {
  const result = await pool.query<OutboxRow>(`SELECT * FROM outbox WHERE execution_id = $1`, [
    executionId,
  ]);

  return result.rows[0] ?? null;
}

export async function countJobsByTitle(title: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM jobs WHERE title = $1`,
    [title],
  );

  return result.rows[0]!.n;
}

export async function countIdempotencyByKey(key: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM idempotency_records WHERE idempotency_key = $1`,
    [key],
  );

  return result.rows[0]!.n;
}

export async function countOutboxForJob(jobId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM outbox WHERE job_id = $1`,
    [jobId],
  );

  return result.rows[0]!.n;
}

export async function countOutboxForExecution(executionId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM outbox WHERE execution_id = $1`,
    [executionId],
  );

  return result.rows[0]!.n;
}

export async function countOutboxRowsForJob(jobId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM outbox
     WHERE job_id = $1
        OR execution_id IN (SELECT id FROM executions WHERE job_id = $1)`,
    [jobId],
  );

  return result.rows[0]!.n;
}

export async function getLease(executionId: string): Promise<LeaseRow | null> {
  const result = await pool.query<LeaseRow>(`SELECT * FROM leases WHERE execution_id = $1`, [
    executionId,
  ]);

  return result.rows[0] ?? null;
}

export async function closeTestPool(): Promise<void> {
  await pool.end();
}
